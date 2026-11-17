/**
 * Unit tests for useLoginForm and resolveLoginErrorKey.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { HttpError, HttpValidationError } from '@sinemacula/foundation/http/http-error';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { useSessionStore } from '@sinemacula/web-core/session/session-store';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import type { LoginForm } from '@/modules/auth/composables/use-login-form';
import { resolveLoginErrorKey, useLoginForm } from '@/modules/auth/composables/use-login-form';
import { initialiseApi, resetApi } from '@/services/api';
import { initialiseStorage, resetStorage } from '@/services/storage';
import { FakeHttpClient } from '@/test-support/fake-http-client';
import { installTestSession, resetSessionContext } from '@/test-support/install-test-session';

const SESSION_KEY = 'auth.session';

/**
 * Build a record from pairs so snake_case wire keys avoid object-literal keys.
 */
function wire(entries: ReadonlyArray<readonly [string, unknown]>): Record<string, unknown> {
    return Object.fromEntries(entries);
}

/**
 * Build the default gateway's session payload.
 */
function sessionPayload(): Record<string, unknown> {
    return wire([
        ['access_token', 'tok'],
        ['refresh_token', 'ref'],
        ['expires_in', 3600],
    ]);
}

/**
 * Queue the responses of one successful sign-in: the session, then the user.
 */
function queueSignIn(fake: FakeHttpClient): void {
    fake.queueResponse({ data: sessionPayload() });
    fake.queueResponse({
        data: wire([
            ['id', 'u1'],
            ['first_name', 'Alice'],
            ['last_name', 'Smith'],
            ['email', 'alice@example.com'],
        ]),
    });
}

interface MountedLoginForm {
    /** The login form returned by the composable. */
    readonly form: LoginForm;

    /** Unmount the host component. */
    readonly unmount: () => void;
}

/**
 * Mount `useLoginForm` in a real component, as vee-validate needs an instance.
 */
function mountLoginForm(): MountedLoginForm {
    const forms: LoginForm[] = [];

    const TestComponent = defineComponent({
        setup() {
            forms.push(useLoginForm());

            return {};
        },
        render() {
            return h('div');
        },
    });

    const pinia = createPinia();
    const div = document.createElement('div');
    const app = createApp(TestComponent).use(pinia);

    setActivePinia(pinia);
    app.mount(div);

    const form = forms[0];

    if (form === undefined) {
        throw new Error('useLoginForm did not initialise');
    }

    return { form, unmount: () => app.unmount() };
}

describe('useLoginForm', () => {
    let fake: FakeHttpClient;
    let storage: MemoryStorage;

    beforeEach(() => {
        storage = new MemoryStorage();
        initialiseStorage(storage);
        installTestSession(storage);
        fake = new FakeHttpClient();
        initialiseApi(fake);
    });

    afterEach(() => {
        resetApi();
        resetStorage();
        resetSessionContext();
    });

    it('initialises with empty fields and no error', () => {
        const { form, unmount } = mountLoginForm();

        expect(form.email.value).toBe('');
        expect(form.password.value).toBe('');
        expect(form.emailError.value).toBe('');
        expect(form.passwordError.value).toBe('');
        expect(form.error.value).toBeNull();
        expect(form.isSubmitting.value).toBe(false);

        unmount();
    });

    describe('submit - validation', () => {
        it.each([
            { email: '', password: 'secret', field: 'emailError', key: 'auth.login.validation.emailRequired' },
            {
                email: 'not-an-email',
                password: 'secret',
                field: 'emailError',
                key: 'auth.login.validation.emailInvalid',
            },
            {
                email: 'alice@example.com',
                password: '',
                field: 'passwordError',
                key: 'auth.login.validation.passwordRequired',
            },
        ] as const)('rejects without calling the API and sets $key', async ({ email, password, field, key }) => {
            const { form, unmount } = mountLoginForm();

            form.email.value = email;
            form.password.value = password;

            const result = await form.submit();

            expect(result).toBe(false);
            expect(form[field].value).toBe(key);
            expect(fake.calls).toHaveLength(0);

            unmount();
        });
    });

    describe('submit - API', () => {
        it('signs in on the default gateway and persists the session', async () => {
            const { form, unmount } = mountLoginForm();

            queueSignIn(fake);
            form.email.value = 'alice@example.com';
            form.password.value = 'correct-password';

            const result = await form.submit();

            expect(result).toBe(true);
            expect(form.error.value).toBeNull();
            expect(form.pending.value).toBeNull();
            expect(form.isSubmitting.value).toBe(false);
            expect(fake.calls).toEqual([
                {
                    method: 'POST',
                    path: 'auth/sign-in',
                    body: { email: 'alice@example.com', password: 'correct-password', platform: 'WEB' },
                    options: { retryOnUnauthorized: false },
                },
                { method: 'GET', path: 'users/self', body: undefined },
            ]);
            expect(JSON.parse(storage.get(SESSION_KEY) ?? 'null')).toMatchObject({
                revision: 1,
                tokens: { accessToken: 'tok', refreshToken: 'ref' },
            });

            unmount();
        });

        it('keeps the pending session when a further step is owed', async () => {
            const { form, unmount } = mountLoginForm();

            fake.queueResponse({
                data: wire([
                    ['pending_credential', 'pending-1'],
                    ['requires', ['mfa']],
                ]),
            });
            form.email.value = 'alice@example.com';
            form.password.value = 'correct-password';

            const result = await form.submit();

            expect(result).toBe(false);
            expect(form.pending.value).toEqual({ credential: 'pending-1', requires: ['mfa'] });
            expect(form.error.value).toBeNull();
            expect(fake.calls).toHaveLength(1);
            expect(storage.get(SESSION_KEY)).toBeNull();

            unmount();
        });

        it('clears the pending session on a subsequent submit attempt', async () => {
            const { form, unmount } = mountLoginForm();

            fake.queueResponse({ data: wire([['pending_credential', 'pending-1']]) });
            form.email.value = 'alice@example.com';
            form.password.value = 'correct-password';

            await form.submit();

            expect(form.pending.value).toEqual({ credential: 'pending-1', requires: [] });

            queueSignIn(fake);

            expect(await form.submit()).toBe(true);
            expect(form.pending.value).toBeNull();

            unmount();
        });

        it('returns false when another session transition overtakes the sign-in', async () => {
            const { form, unmount } = mountLoginForm();

            /** Resolve the queued sign-in response. */
            let release: (payload: unknown) => void = () => undefined;

            fake.queueResponse(
                new Promise(resolve => {
                    release = resolve;
                }),
            );
            form.email.value = 'alice@example.com';
            form.password.value = 'correct-password';

            const submission = form.submit();

            await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
            await useSessionStore().clearLocal();
            release({ data: sessionPayload() });

            expect(await submission).toBe(false);
            expect(form.error.value).toBeNull();
            expect(form.pending.value).toBeNull();
            expect(useSessionStore().isAuthenticated).toBe(false);
            expect(fake.calls).toHaveLength(1);

            unmount();
        });

        it('returns false and sets an error key on a failed login', async () => {
            const { form, unmount } = mountLoginForm();

            fake.queueError(new HttpError(401, 'Unauthorized'));

            form.email.value = 'alice@example.com';
            form.password.value = 'wrong-password';

            const result = await form.submit();

            expect(result).toBe(false);
            expect(form.error.value).toBe('auth.login.errors.invalid');
            expect(form.isSubmitting.value).toBe(false);

            unmount();
        });

        it('clears the API error on a subsequent submit attempt', async () => {
            const { form, unmount } = mountLoginForm();

            fake.queueError(new HttpError(401, 'Unauthorized'));

            form.email.value = 'alice@example.com';
            form.password.value = 'wrong-password';

            await form.submit();

            expect(form.error.value).toBe('auth.login.errors.invalid');

            queueSignIn(fake);

            await form.submit();

            expect(form.error.value).toBeNull();

            unmount();
        });

        it('surfaces 422 field errors as field messages', async () => {
            const { form, unmount } = mountLoginForm();

            fake.queueError(
                new HttpValidationError(
                    422,
                    'Unprocessable',
                    {},
                    {
                        email: ['The email has already been taken.'],
                        password: [],
                    },
                ),
            );

            form.email.value = 'alice@example.com';
            form.password.value = 'secret';

            const result = await form.submit();

            expect(result).toBe(false);
            expect(form.emailError.value).toBe('The email has already been taken.');
            expect(form.passwordError.value).toBe('');
            expect(form.error.value).toBeNull();

            unmount();
        });

        it('falls back to the form-level error on a 422 without field errors', async () => {
            const { form, unmount } = mountLoginForm();

            fake.queueError(new HttpValidationError(422, 'Unprocessable', {}, {}));

            form.email.value = 'alice@example.com';
            form.password.value = 'secret';

            const result = await form.submit();

            expect(result).toBe(false);
            expect(form.error.value).toBe('auth.login.errors.invalid');

            unmount();
        });

        it('ignores a second submit while one is in flight', async () => {
            const { form, unmount } = mountLoginForm();

            queueSignIn(fake);

            form.email.value = 'alice@example.com';
            form.password.value = 'correct-password';

            const first = form.submit();
            const second = form.submit();

            const [firstResult, secondResult] = await Promise.all([first, second]);

            expect(firstResult).toBe(true);
            expect(secondResult).toBe(false);
            expect(fake.calls).toHaveLength(2);

            unmount();
        });
    });
});

describe('resolveLoginErrorKey', () => {
    it('returns the invalid credentials key for HttpValidationError', () => {
        const error = new HttpValidationError(422, 'Unprocessable', {}, {});

        expect(resolveLoginErrorKey(error)).toBe('auth.login.errors.invalid');
    });

    it('returns the invalid credentials key for HttpError with status 401', () => {
        const error = new HttpError(401, 'Unauthorized');

        expect(resolveLoginErrorKey(error)).toBe('auth.login.errors.invalid');
    });

    it('returns the generic error key for an HttpError with a non-401 status', () => {
        const error = new HttpError(500, 'Internal Server Error');

        expect(resolveLoginErrorKey(error)).toBe('common.states.error');
    });

    it('returns the generic error key for a plain Error', () => {
        const error = new Error('unexpected');

        expect(resolveLoginErrorKey(error)).toBe('common.states.error');
    });
});
