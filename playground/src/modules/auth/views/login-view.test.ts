/**
 * Component tests for login-view.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { HttpError } from '@sinemacula/foundation/http/http-error';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';

import { AUTH_ROUTE_NAMES } from '@/modules/auth/route-names';
import LoginView from '@/modules/auth/views/login-view.vue';
import { initialiseApi, resetApi } from '@/services/api';
import { initialiseStorage, resetStorage } from '@/services/storage';
import { FakeHttpClient } from '@/test-support/fake-http-client';
import { installTestSession, resetSessionContext } from '@/test-support/install-test-session';

/**
 * Build a record from pairs so snake_case wire keys avoid object-literal keys.
 */
function wire(entries: ReadonlyArray<readonly [string, unknown]>): Record<string, unknown> {
    return Object.fromEntries(entries);
}

interface MountedLoginView {
    /** The element the view is mounted into. */
    readonly container: HTMLDivElement;

    /** The router the view is mounted with. */
    readonly router: ReturnType<typeof createRouter>;

    /** Unmount the view and detach its container. */
    readonly unmount: () => void;
}

/**
 * Mount LoginView with the minimal plugins it needs.
 */
function mountLoginView(): MountedLoginView {
    const pinia = createPinia();
    const i18n = createI18n({ legacy: false, locale: 'en-US', messages: {} });
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', component: { template: '<div />' } },
            { path: '/login', name: AUTH_ROUTE_NAMES.login, component: LoginView },
            { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
        ],
    });

    const container = document.createElement('div') as HTMLDivElement;

    document.body.appendChild(container);

    const app = createApp(LoginView);

    setActivePinia(pinia);
    app.use(pinia).use(i18n).use(router);
    app.mount(container);

    return {
        container,
        router,
        unmount: () => {
            app.unmount();
            container.remove();
        },
    };
}

/**
 * Queue the sign-in and current-user responses of a successful login.
 */
function queueSuccessfulLogin(fake: FakeHttpClient): void {
    fake.queueResponse({
        data: wire([
            ['access_token', 'tok'],
            ['refresh_token', 'ref'],
            ['expires_in', 3600],
        ]),
    });
    fake.queueResponse({
        data: wire([
            ['id', 'u1'],
            ['first_name', 'Alice'],
            ['last_name', 'Smith'],
            ['email', 'alice@example.com'],
        ]),
    });
}

/**
 * Dispatch a submit event on the form inside the given container.
 */
function submitForm(container: HTMLDivElement): void {
    const form = container.querySelector('form');

    if (form === null) {
        throw new Error('login form not found');
    }

    form.dispatchEvent(new Event('submit'));
}

/**
 * Type a valid email and the given password into the mounted form.
 */
function fillCredentials(container: HTMLDivElement, password: string): void {
    const emailInput = container.querySelector<HTMLInputElement>('input[type="email"]');
    const passwordInput = container.querySelector<HTMLInputElement>('input[type="password"]');

    if (emailInput === null || passwordInput === null) {
        throw new Error('form inputs not found');
    }

    emailInput.value = 'alice@example.com';
    emailInput.dispatchEvent(new Event('input'));
    passwordInput.value = password;
    passwordInput.dispatchEvent(new Event('input'));
}

describe('LoginView', () => {
    beforeEach(() => {
        const storage = new MemoryStorage();

        initialiseStorage(storage);
        installTestSession(storage);
        initialiseApi(new FakeHttpClient());
        setActivePinia(createPinia());
    });

    afterEach(() => {
        resetApi();
        resetStorage();
        resetSessionContext();
    });

    it('renders the login form', () => {
        const { container, unmount } = mountLoginView();

        expect(container.querySelector('form')).not.toBeNull();

        unmount();
    });

    it('does not navigate when validation fails', async () => {
        const { container, router, unmount } = mountLoginView();

        await router.isReady();

        const pushSpy = vi.spyOn(router, 'push');

        submitForm(container);

        await new Promise<void>(resolve => setTimeout(resolve, 50));

        expect(pushSpy).not.toHaveBeenCalled();

        unmount();
    });

    it('shows field errors after a failed validation submit', async () => {
        const fake = new FakeHttpClient();

        initialiseApi(fake);

        const { container, unmount } = mountLoginView();

        submitForm(container);

        await new Promise<void>(resolve => setTimeout(resolve, 50));

        expect(container.querySelector('.sm-text-input__error')).not.toBeNull();

        unmount();
    });

    it('shows an API error after a rejected login', async () => {
        const fake = new FakeHttpClient();

        fake.queueError(new HttpError(401, 'Unauthorized'));
        initialiseApi(fake);

        const { container, unmount } = mountLoginView();

        fillCredentials(container, 'wrong-password');
        submitForm(container);

        await new Promise<void>(resolve => setTimeout(resolve, 50));

        expect(container.querySelector('.login-form__error')).not.toBeNull();

        unmount();
    });

    it('redirects to / on a successful login', async () => {
        const fake = new FakeHttpClient();

        queueSuccessfulLogin(fake);
        initialiseApi(fake);

        const { container, router, unmount } = mountLoginView();

        await router.isReady();

        const pushSpy = vi.spyOn(router, 'push');

        fillCredentials(container, 'correct-password');
        submitForm(container);

        await new Promise<void>(resolve => setTimeout(resolve, 50));

        expect(pushSpy).toHaveBeenCalledWith('/');

        unmount();
    });

    it.each([
        ['an in-app path with its query', '/users?page=2', '/users?page=2'],
        ['a protocol-relative URL', '/', '//evil.example'],
        ['an absolute URL', '/', 'https://evil.example'],
        ['a backslash path', '/', '/\\evil.example'],
        ['the login route itself', '/', '/login?redirect=/users'],
    ])('sends a sign-in redirected to %s on to %s', async (_case, expected, target) => {
        const fake = new FakeHttpClient();

        queueSuccessfulLogin(fake);
        initialiseApi(fake);

        const { container, router, unmount } = mountLoginView();

        await router.push({ path: '/login', query: { redirect: target } });

        const pushSpy = vi.spyOn(router, 'push');

        fillCredentials(container, 'correct-password');
        submitForm(container);

        await new Promise<void>(resolve => setTimeout(resolve, 50));

        expect(pushSpy).toHaveBeenCalledWith(expected);

        unmount();
    });

    it('does not navigate when the sign-in owes a further step', async () => {
        const fake = new FakeHttpClient();

        fake.queueResponse({ data: wire([['pending_credential', 'pending-1']]) });
        initialiseApi(fake);

        const { container, router, unmount } = mountLoginView();

        await router.isReady();

        const pushSpy = vi.spyOn(router, 'push');

        fillCredentials(container, 'correct-password');
        submitForm(container);

        await new Promise<void>(resolve => setTimeout(resolve, 50));

        expect(fake.calls).toHaveLength(1);
        expect(pushSpy).not.toHaveBeenCalled();

        unmount();
    });
});
