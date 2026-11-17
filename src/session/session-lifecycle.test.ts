/**
 * Unit tests for the session lifecycle wired at the module's boot phase.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError, NetworkError } from '@sinemacula/foundation/http/http-error';
import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import { SessionError } from '@sinemacula/foundation/session/session-error';
import type { SessionSnapshot } from '@sinemacula/foundation/session/session-persistence';
import type { SessionTokens } from '@sinemacula/foundation/session/session-tokens';
import type { SessionUser } from '@sinemacula/foundation/session/session-user';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { resetWebCoreServices } from '../app/services';
import type { SessionModuleOptions } from './create-session-module';
import { createSessionModule } from './create-session-module';
import { resetSessionContext, sessionContext } from './session-context';
import type { FakeSessionApi, ManualScheduler } from './test-support/session-fixtures';
import {
    createFakeSessionApi,
    createManualScheduler,
    createRecordingConnection,
    deferred,
    persistSnapshot,
    tokens,
    user,
} from './test-support/session-fixtures';
import type { HarnessSetup, SessionHarness } from './test-support/session-harness';
import { createSessionHarness } from './test-support/session-harness';

const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;

/**
 * Settle every pending promise and zero-delay timer.
 */
async function settle(): Promise<void> {
    await new Promise(resolve => {
        setTimeout(resolve, 0);
    });
}

describe('session lifecycle', () => {
    let gateway: FakeSessionApi;

    /**
     * Register the module over the fake gateway.
     */
    function harness(options: SessionModuleOptions = {}, setup: HarnessSetup = {}): SessionHarness {
        return createSessionHarness(createSessionModule({ api: () => gateway, ...options }), setup);
    }

    /**
     * Register over a persisted session whose user loads, without booting.
     */
    function persisted(options: SessionModuleOptions = {}, setup: HarnessSetup = {}): SessionHarness {
        const target = harness(options, setup);

        persistSnapshot(target.win.localStorage, tokens());
        gateway.currentUser.mockResolvedValue(user());

        return target;
    }

    beforeEach(() => {
        gateway = createFakeSessionApi();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        resetWebCoreServices();
        resetSessionContext();
    });

    describe('boot', () => {
        it('waits for the hydration before wiring anything', async () => {
            const target = harness();
            const gate = deferred<SessionSnapshot>();

            vi.spyOn(KeyValueSessionPersistence.prototype, 'load').mockReturnValueOnce(gate.promise);

            let booted = false;
            const booting = target.boot().then(teardown => {
                booted = true;

                return teardown;
            });

            await Promise.resolve();

            expect(booted).toBe(false);
            expect(target.win.listenerCount()).toBe(0);

            gate.resolve({ revision: 0, tokens: null });
            await booting;

            expect(target.win.listenerCount()).toBe(1);
        });

        it('loads the user of a hydrated session once wired', async () => {
            const target = persisted();

            await target.boot();

            await vi.waitFor(() => {
                expect(target.store().user).toStrictEqual(user());
            });
        });

        it('fetches no user while signed out', async () => {
            await harness().boot();

            expect(gateway.currentUser).not.toHaveBeenCalled();
        });

        it('tears everything down', async () => {
            const target = persisted();
            const teardown = await target.boot();

            await vi.waitFor(() => {
                expect(target.store().user).not.toBeNull();
            });

            teardown();
            await target.store().clearLocal();

            expect(target.win.listenerCount()).toBe(0);
            expect(target.pushes).toStrictEqual([]);
            expect(target.observability.resets).toStrictEqual([]);
        });
    });

    describe('session-loss redirect', () => {
        it('sends a lost session to the login route, carrying the current path', async () => {
            const target = persisted();

            await target.boot();
            await target.store().clearLocal();

            await vi.waitFor(() => {
                expect(target.pushes).toStrictEqual([{ name: 'auth.login', query: { redirect: '/dashboard' } }]);
            });
        });

        it('carries no return target from the login page itself', async () => {
            const target = persisted({}, { fullPath: '/login' });

            await target.boot();
            await target.store().clearLocal();

            await vi.waitFor(() => {
                expect(target.pushes).toStrictEqual([{ name: 'auth.login' }]);
            });
        });

        it('contains a rejected navigation', async () => {
            const target = persisted({}, { pushRejection: new Error('navigation aborted') });

            await target.boot();
            await target.store().clearLocal();

            await vi.waitFor(() => {
                expect(target.pushes).toHaveLength(1);
            });
        });

        it('redirects when the boot user fetch finds the session refused', async () => {
            const target = persisted();

            gateway.currentUser.mockReset();
            gateway.currentUser.mockImplementationOnce(async () => {
                await sessionContext().coordinator.refresh();

                throw new HttpError(401, 'expired');
            });
            gateway.refresh.mockResolvedValueOnce({ kind: 'rejected', error: new HttpError(401, 'refused') });

            await target.boot();

            await vi.waitFor(() => {
                expect(target.pushes).toStrictEqual([{ name: 'auth.login', query: { redirect: '/dashboard' } }]);
            });
            expect(target.store().isAuthenticated).toBe(false);
        });

        it('stays put when a session begins', async () => {
            const target = harness();

            await target.boot();

            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
            gateway.currentUser.mockResolvedValueOnce(user());
            await target.store().login({ email: 'a', password: 'b' });
            await settle();

            expect(target.store().isAuthenticated).toBe(true);
            expect(target.pushes).toStrictEqual([]);
        });

        it('stays put when disabled', async () => {
            const target = persisted({ sessionLossRedirect: false });

            await target.boot();
            await target.store().clearLocal();
            await vi.waitFor(() => {
                expect(target.store().isAuthenticated).toBe(false);
            });

            expect(target.pushes).toStrictEqual([]);
        });
    });

    describe('cross-tab sync', () => {
        it('adopts a session another tab persisted, then loads its user', async () => {
            const target = harness();

            await target.boot();

            persistSnapshot(target.win.localStorage, tokens({ accessToken: 'other-tab' }), 5);
            gateway.currentUser.mockResolvedValueOnce(user({ id: 'u2' }));
            target.win.dispatchStorage({ key: 'auth.session' });

            await vi.waitFor(() => {
                expect(target.store().user?.id).toBe('u2');
            });
            expect(target.store().accessToken).toBe('other-tab');
        });

        it('signs out when another tab clears the session', async () => {
            const target = persisted();

            await target.boot();

            persistSnapshot(target.win.localStorage, null, 2);
            target.win.dispatchStorage({ key: 'auth.session' });

            await vi.waitFor(() => {
                expect(target.store().isAuthenticated).toBe(false);
            });
        });

        it('signs out when another tab clears the whole storage', async () => {
            const target = persisted();

            await target.boot();

            target.win.localStorage.clear();
            target.win.dispatchStorage({ key: null });

            await vi.waitFor(() => {
                expect(target.store().isAuthenticated).toBe(false);
            });
        });

        it.each([
            ['another key', { key: 'theme' }],
            ['another storage area', { key: 'auth.session', storageArea: {} as Storage }],
        ])('ignores a change to %s', async (_label, event) => {
            const target = harness();
            const load = vi.spyOn(KeyValueSessionPersistence.prototype, 'load');

            await target.boot();
            await settle();

            const loads = load.mock.calls.length;

            target.win.dispatchStorage(event);
            await settle();

            expect(load).toHaveBeenCalledTimes(loads);
        });

        it.each([
            ['the session key', { key: 'auth.session' }],
            ['a clear of the storage', { key: null }],
        ])('resynchronises on a change to %s', async (_label, event) => {
            const target = harness();
            const load = vi.spyOn(KeyValueSessionPersistence.prototype, 'load');

            await target.boot();
            await settle();

            const loads = load.mock.calls.length;

            target.win.dispatchStorage(event);
            await settle();

            expect(load).toHaveBeenCalledTimes(loads + 1);
        });

        it('loads no user after a failed synchronisation', async () => {
            const target = harness();

            persistSnapshot(target.win.localStorage, tokens());
            gateway.currentUser.mockRejectedValue(new NetworkError('offline'));
            await target.boot();
            await vi.waitFor(() => {
                expect(gateway.currentUser).toHaveBeenCalledTimes(1);
            });

            target.win.localStorage.setItem('auth.session', 'not json');
            target.win.dispatchStorage({ key: 'auth.session' });

            await vi.waitFor(() => {
                expect(target.observability.errors).toHaveLength(1);
            });
            await settle();
            expect(gateway.currentUser).toHaveBeenCalledTimes(1);
        });

        it('reports a failed synchronisation and keeps the session', async () => {
            const target = persisted();

            await target.boot();

            target.win.localStorage.setItem('auth.session', 'not json');
            target.win.dispatchStorage({ key: 'auth.session' });

            await vi.waitFor(() => {
                expect(target.observability.errors).toHaveLength(1);
            });
            expect(target.store().isAuthenticated).toBe(true);
        });

        it('starts no user fetch once torn down mid-synchronisation', async () => {
            const target = harness();
            const teardown = await target.boot();
            const gate = deferred<SessionSnapshot>();

            vi.spyOn(KeyValueSessionPersistence.prototype, 'load').mockReturnValueOnce(gate.promise);
            target.win.dispatchStorage({ key: 'auth.session' });
            teardown();
            gate.resolve({ revision: 9, tokens: tokens() });

            await vi.waitFor(() => {
                expect(target.store().isAuthenticated).toBe(true);
            });
            expect(gateway.currentUser).not.toHaveBeenCalled();
        });

        it('catches a change persisted between the hydration and the listener', async () => {
            const target = harness();

            target.stores();
            await sessionContext().ready();
            persistSnapshot(target.win.localStorage, tokens({ accessToken: 'during-boot' }), 3);
            gateway.currentUser.mockResolvedValueOnce(user());

            await target.boot();

            expect(target.store().accessToken).toBe('during-boot');
        });

        it('reports a failed reconciliation and still boots', async () => {
            const target = harness();

            await sessionContext().ready();
            target.win.localStorage.setItem('auth.session', 'not json');

            await target.boot();

            expect(target.observability.errors).toHaveLength(1);
            expect(target.win.listenerCount()).toBe(1);
        });

        it('reports a cold boot over an unreadable session once, and a later sign-in heals it', async () => {
            const target = harness();

            target.win.localStorage.setItem('auth.session', 'not json');
            await target.boot();

            expect(target.observability.errors).toHaveLength(1);
            expect(target.store().isAuthenticated).toBe(false);

            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
            gateway.currentUser.mockResolvedValueOnce(user());
            await target.store().login({ email: 'a', password: 'b' });

            expect(JSON.parse(target.win.localStorage.getItem('auth.session') ?? '')).toStrictEqual({
                revision: 1,
                tokens: tokens(),
            });
        });

        it('reports a different hydration failure', async () => {
            const target = harness();

            vi.spyOn(KeyValueSessionPersistence.prototype, 'load')
                .mockRejectedValueOnce(new SessionError('unreadable'))
                .mockRejectedValueOnce(new DOMException('blocked', 'SecurityError'));
            await target.boot();

            expect(target.observability.errors).toHaveLength(2);
        });

        it('reports the same failure again once a hydration has succeeded', async () => {
            const target = harness();

            target.win.localStorage.setItem('auth.session', 'not json');
            await target.boot();

            persistSnapshot(target.win.localStorage, tokens(), 2);
            gateway.currentUser.mockResolvedValue(user());
            target.win.dispatchStorage({ key: 'auth.session' });
            await vi.waitFor(() => {
                expect(target.store().isAuthenticated).toBe(true);
            });

            target.win.localStorage.setItem('auth.session', 'not json');
            target.win.dispatchStorage({ key: 'auth.session' });

            await vi.waitFor(() => {
                expect(target.observability.errors).toHaveLength(2);
            });
        });

        it('refuses to boot over a blocked localStorage, naming the option', async () => {
            const target = harness(
                { persistence: () => new KeyValueSessionPersistence(new MemoryStorage()) },
                {
                    storageBlocked: true,
                },
            );
            const refusal: unknown = await target.boot().catch((error: unknown) => error);

            expect(refusal).toBeInstanceOf(SessionError);
            expect(refusal).toHaveProperty('message', expect.stringContaining('crossTabSync'));
            expect(refusal).toHaveProperty('cause.name', 'SecurityError');
        });

        it('boots without listening when blocked storage keeps the default session in memory', async () => {
            const target = harness({}, { storageBlocked: true });

            await expect(target.boot()).resolves.toBeTypeOf('function');

            expect(target.win.listenerCount()).toBe(0);
            expect(target.observability.errors).toStrictEqual([]);
        });

        it('boots over a blocked localStorage when disabled', async () => {
            const target = harness(
                { crossTabSync: false, persistence: () => new KeyValueSessionPersistence(new MemoryStorage()) },
                { storageBlocked: true },
            );

            await expect(target.boot()).resolves.toBeTypeOf('function');
        });

        it('neither listens nor reconciles when disabled', async () => {
            const target = harness({ crossTabSync: false });
            const load = vi.spyOn(KeyValueSessionPersistence.prototype, 'load');

            await target.boot();

            expect(target.win.listenerCount()).toBe(0);
            expect(load).toHaveBeenCalledTimes(1);
        });
    });

    describe('identity fan-out', () => {
        it('identifies the loaded user on every channel', async () => {
            const target = persisted();

            await target.boot();

            await vi.waitFor(() => {
                expect(target.observability.reportedUsers).toStrictEqual([
                    { id: 'u1', email: 'alice@example.com', name: 'Alice Smith' },
                ]);
            });
            expect(target.observability.identified).toStrictEqual(['u1']);
            expect(target.observability.flagContexts).toStrictEqual([{ userId: 'u1' }]);
        });

        it('omits an absent email and name from the reported identity', async () => {
            const target = harness();

            persistSnapshot(target.win.localStorage, tokens());
            gateway.currentUser.mockResolvedValue({ id: 7, email: null, name: null, permissions: [] });
            await target.boot();

            await vi.waitFor(() => {
                expect(target.observability.reportedUsers).toStrictEqual([{ id: '7' }]);
            });
        });

        it('clears every channel on sign-out', async () => {
            const target = persisted();

            await target.boot();
            await vi.waitFor(() => {
                expect(target.observability.identified).toHaveLength(1);
            });
            await target.store().clearLocal();

            await vi.waitFor(() => {
                expect(target.observability.resets).toHaveLength(1);
            });
            expect(target.observability.reportedUsers.at(-1)).toBeNull();
            expect(target.observability.flagContexts.at(-1)).toStrictEqual({});
        });

        it('identifies a user already signed in when booting', async () => {
            const target = harness();

            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
            gateway.currentUser.mockResolvedValueOnce(user());
            await target.store().login({ email: 'a', password: 'b' });

            await target.boot();

            expect(target.observability.identified).toStrictEqual(['u1']);
        });

        it('touches no channel when booting signed out', async () => {
            const target = harness();

            await target.boot();

            expect(target.observability.reportedUsers).toStrictEqual([]);
            expect(target.observability.resets).toStrictEqual([]);
            expect(target.observability.flagContexts).toStrictEqual([]);
        });

        it('merges per-channel mappings over the defaults', async () => {
            const target = persisted({ identity: { analytics: (signedIn: SessionUser) => `user-${signedIn.id}` } });

            await target.boot();

            await vi.waitFor(() => {
                expect(target.observability.identified).toStrictEqual(['user-u1']);
            });
            expect(target.observability.flagContexts).toStrictEqual([{ userId: 'u1' }]);
        });

        it('touches no channel when a session whose user never loaded ends', async () => {
            const target = harness();

            persistSnapshot(target.win.localStorage, tokens());
            gateway.currentUser.mockRejectedValue(new NetworkError('offline'));
            await target.boot();
            await vi.waitFor(() => {
                expect(gateway.currentUser).toHaveBeenCalled();
            });

            await target.store().clearLocal();
            await settle();

            expect(target.observability.reportedUsers).toStrictEqual([]);
            expect(target.observability.resets).toStrictEqual([]);
            expect(target.observability.flagContexts).toStrictEqual([]);
        });

        it('fans nothing out when disabled, even when the user cannot be loaded', async () => {
            const target = harness({ identity: false });

            persistSnapshot(target.win.localStorage, tokens());
            gateway.currentUser.mockRejectedValue(new NetworkError('offline'));
            await target.boot();
            await vi.waitFor(() => {
                expect(gateway.currentUser).toHaveBeenCalled();
            });
            await settle();

            expect(target.observability.resets).toStrictEqual([]);
            expect(target.observability.errors).toStrictEqual([]);
        });

        it('fans nothing out when disabled', async () => {
            const target = persisted({ identity: false });

            await target.boot();
            await vi.waitFor(() => {
                expect(target.store().user).not.toBeNull();
            });

            expect(target.observability.identified).toStrictEqual([]);
        });

        describe('across tabs', () => {
            /**
             * Boot over a persisted session whose user has been identified.
             */
            async function identified(options: SessionModuleOptions = {}): Promise<SessionHarness> {
                const target = persisted(options);

                await target.boot();
                await vi.waitFor(() => {
                    expect(target.observability.identified).toStrictEqual(['u1']);
                });

                return target;
            }

            /**
             * Persist the given tokens as another tab would, and announce it.
             */
            function persistElsewhere(target: SessionHarness, persisted: SessionTokens | null, revision = 2): void {
                persistSnapshot(target.win.localStorage, persisted, revision);
                target.win.dispatchStorage({ key: 'auth.session' });
            }

            it('touches no channel when another tab rotates the session', async () => {
                const target = await identified();

                persistElsewhere(target, tokens({ accessToken: 'rotated', refreshToken: 'rotated-refresh' }));

                await vi.waitFor(() => {
                    expect(gateway.currentUser).toHaveBeenCalledTimes(2);
                    expect(target.store().user).not.toBeNull();
                });
                await settle();

                expect(target.store().accessToken).toBe('rotated');
                expect(target.observability.reportedUsers).toHaveLength(1);
                expect(target.observability.identified).toStrictEqual(['u1']);
                expect(target.observability.resets).toStrictEqual([]);
                expect(target.observability.flagContexts).toStrictEqual([{ userId: 'u1' }]);
            });

            it('resets before identifying a different user another tab signs in', async () => {
                const target = await identified();

                gateway.currentUser.mockResolvedValue(user({ id: 'u2', email: null, name: null }));
                persistElsewhere(target, tokens({ accessToken: 'other-user' }));

                await vi.waitFor(() => {
                    expect(target.observability.analyticsCalls).toStrictEqual(['identify u1', 'reset', 'identify u2']);
                });
                expect(target.observability.reportedUsers.at(-1)).toStrictEqual({ id: 'u2' });
                expect(target.observability.flagContexts.at(-1)).toStrictEqual({ userId: 'u2' });
            });

            it('updates only the channels whose mapped value changed', async () => {
                const target = await identified();

                gateway.currentUser.mockResolvedValue(user({ name: 'Alice Jones' }));
                persistElsewhere(target, tokens({ accessToken: 'rotated' }));

                await vi.waitFor(() => {
                    expect(target.observability.reportedUsers).toHaveLength(2);
                });
                expect(target.observability.reportedUsers.at(-1)).toStrictEqual({
                    id: 'u1',
                    email: 'alice@example.com',
                    name: 'Alice Jones',
                });
                expect(target.observability.identified).toStrictEqual(['u1']);
                expect(target.observability.resets).toStrictEqual([]);
                expect(target.observability.flagContexts).toHaveLength(1);
            });

            it('reports again an identity that lost a field', async () => {
                const target = await identified();

                gateway.currentUser.mockResolvedValue(user({ email: null }));
                persistElsewhere(target, tokens({ accessToken: 'rotated' }));

                await vi.waitFor(() => {
                    expect(target.observability.reportedUsers).toHaveLength(2);
                });
                expect(target.observability.reportedUsers.at(-1)).toStrictEqual({ id: 'u1', name: 'Alice Smith' });
            });

            it('clears every channel when the adopted session user cannot be loaded', async () => {
                const target = await identified();

                gateway.currentUser.mockRejectedValue(new NetworkError('offline'));
                persistElsewhere(target, tokens({ accessToken: 'rotated' }));

                await vi.waitFor(() => {
                    expect(target.observability.resets).toHaveLength(1);
                });
                expect(target.store().isAuthenticated).toBe(true);
                expect(target.observability.reportedUsers.at(-1)).toBeNull();
                expect(target.observability.flagContexts.at(-1)).toStrictEqual({});
            });

            it('leaves every channel alone when a superseded adoption fails to load its user', async () => {
                const target = await identified();
                const superseded = deferred<SessionUser>();
                const current = deferred<SessionUser>();

                gateway.currentUser.mockReturnValueOnce(superseded.promise).mockReturnValueOnce(current.promise);
                persistElsewhere(target, tokens({ accessToken: 'first' }));
                await vi.waitFor(() => {
                    expect(gateway.currentUser).toHaveBeenCalledTimes(2);
                });
                persistElsewhere(target, tokens({ accessToken: 'second' }), 3);
                await vi.waitFor(() => {
                    expect(gateway.currentUser).toHaveBeenCalledTimes(3);
                });

                superseded.reject(new NetworkError('offline'));
                await settle();
                current.resolve(user());
                await settle();

                expect(target.store().accessToken).toBe('second');
                expect(target.observability.resets).toStrictEqual([]);
                expect(target.observability.reportedUsers).toHaveLength(1);
            });

            it('leaves every channel alone when the adopted user fails to load after teardown', async () => {
                const target = persisted();
                const teardown = await target.boot();
                const loading = deferred<SessionUser>();

                await vi.waitFor(() => {
                    expect(target.observability.identified).toStrictEqual(['u1']);
                });
                gateway.currentUser.mockReturnValueOnce(loading.promise);
                persistSnapshot(target.win.localStorage, tokens({ accessToken: 'rotated' }), 2);
                target.win.dispatchStorage({ key: 'auth.session' });
                await vi.waitFor(() => {
                    expect(gateway.currentUser).toHaveBeenCalledTimes(2);
                });

                teardown();
                loading.reject(new NetworkError('offline'));
                await settle();

                expect(target.observability.resets).toStrictEqual([]);
                expect(target.observability.reportedUsers).toHaveLength(1);
            });

            it('clears every channel when the session ends before the adopted user loads', async () => {
                const target = await identified();
                const loading = deferred<SessionUser>();

                gateway.currentUser.mockReturnValueOnce(loading.promise);
                persistElsewhere(target, tokens({ accessToken: 'rotated' }));
                await vi.waitFor(() => {
                    expect(gateway.currentUser).toHaveBeenCalledTimes(2);
                });

                persistElsewhere(target, null, 3);

                await vi.waitFor(() => {
                    expect(target.observability.resets).toHaveLength(1);
                });
                expect(target.observability.reportedUsers.at(-1)).toBeNull();
            });
        });
    });

    describe('proactive refresh', () => {
        let now: number;
        let scheduler: ManualScheduler;

        /**
         * Register over a persisted session expiring at the given instant, on a
         * platform clock and scheduler the test drives.
         */
        function expiring(
            expiresAtEpochMs: number,
            options: SessionModuleOptions = {},
            setup: HarnessSetup = {},
        ): SessionHarness {
            now = 1_000_000;
            scheduler = createManualScheduler();

            const target = harness(options, { clock: () => now, schedule: scheduler.schedule, ...setup });

            persistSnapshot(target.win.localStorage, tokens({ expiresAtEpochMs }));
            gateway.currentUser.mockResolvedValue(user());

            return target;
        }

        beforeEach(() => {
            vi.spyOn(Math, 'random').mockReturnValue(0);
        });

        it('arms the refresh the skew ahead of expiry on the platform clock, then follows the new expiry', async () => {
            const target = expiring(1_000_000 + 120_000);

            gateway.refresh.mockResolvedValueOnce({
                kind: 'refreshed',
                tokens: tokens({ expiresAtEpochMs: 1_000_000 + 300_000 }),
            });
            await target.boot();

            expect(scheduler.delays()).toStrictEqual([60_000]);
            expect(gateway.refresh).not.toHaveBeenCalled();

            now += 60_000;
            scheduler.flush();

            await vi.waitFor(() => {
                expect(scheduler.delays()).toStrictEqual([180_000]);
            });
            expect(gateway.refresh).toHaveBeenCalledTimes(1);
        });

        it.each([
            [0.5, 75_000],
            [0.999_99, 89_999],
        ])('spreads the refresh over the earlier half of the skew window for a sample of %d', async (sample, delay) => {
            vi.mocked(Math.random).mockReturnValue(sample);

            await expiring(1_000_000 + 120_000).boot();

            expect(scheduler.delays()).toStrictEqual([delay]);
        });

        it('honours a custom skew', async () => {
            await expiring(1_000_000 + 10_000, { refreshSkewMs: 4_000 }).boot();

            expect(scheduler.delays()).toStrictEqual([6_000]);
        });

        it('refreshes at once inside the skew', async () => {
            const target = expiring(1_000_000 + 1_000);

            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens() });
            await target.boot();

            expect(scheduler.delays()).toStrictEqual([0]);

            scheduler.flush();

            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalledTimes(1);
            });
        });

        it('disarms when the session ends', async () => {
            const target = expiring(1_000_000 + 120_000);

            await target.boot();
            await target.store().clearLocal();
            await settle();

            expect(scheduler.delays()).toStrictEqual([]);
        });

        it('re-evaluates at the longest timer delay instead of overflowing', async () => {
            const target = expiring(1_000_000 + MAX_TIMEOUT_DELAY_MS + 120_000);

            await target.boot();

            expect(scheduler.delays()).toStrictEqual([MAX_TIMEOUT_DELAY_MS]);

            now += MAX_TIMEOUT_DELAY_MS;
            scheduler.flush();

            expect(scheduler.delays()).toStrictEqual([60_000]);
            expect(gateway.refresh).not.toHaveBeenCalled();
        });

        it('arms the refresh itself at exactly the longest timer delay', async () => {
            const target = expiring(1_000_000 + MAX_TIMEOUT_DELAY_MS + 60_000);

            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens() });
            await target.boot();

            expect(scheduler.delays()).toStrictEqual([MAX_TIMEOUT_DELAY_MS]);

            scheduler.flush();

            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalledTimes(1);
            });
        });

        it('keeps the session and arms nothing further when the proactive refresh fails transiently', async () => {
            const target = expiring(1_000_000 + 1_000);

            gateway.refresh.mockResolvedValueOnce({ kind: 'retryable', error: new NetworkError('offline') });
            await target.boot();
            scheduler.flush();

            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalledTimes(1);
            });
            await settle();

            expect(target.store().accessToken).toBe('access');
            expect(target.pushes).toStrictEqual([]);
            expect(target.observability.errors).toStrictEqual([]);
            expect(scheduler.delays()).toStrictEqual([]);
        });

        it('redirects when the proactive refresh is refused', async () => {
            const target = expiring(1_000_000 + 1_000);

            gateway.refresh.mockResolvedValueOnce({ kind: 'rejected', error: new HttpError(401, 'refused') });
            await target.boot();
            scheduler.flush();

            await vi.waitFor(() => {
                expect(target.pushes).toStrictEqual([{ name: 'auth.login', query: { redirect: '/dashboard' } }]);
            });
            expect(target.store().isAuthenticated).toBe(false);
        });

        it('disconnects an open connection when the proactive refresh fails, keeping the session', async () => {
            const connection = createRecordingConnection();
            const failure = new HttpError(422, 'malformed');
            const target = expiring(1_000_000 + 120_000, {}, { realtime: connection });

            gateway.refresh.mockResolvedValueOnce({ kind: 'failed', error: failure });
            await target.boot();
            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });

            scheduler.flush();

            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect', 'disconnect']);
            });
            expect(target.observability.errors).toStrictEqual([failure]);
            expect(target.store().isAuthenticated).toBe(true);
            expect(scheduler.delays()).toStrictEqual([]);
        });

        it('arms nothing when disabled', async () => {
            await expiring(1_000_000 + 1_000, { proactiveRefresh: false }).boot();

            expect(scheduler.delays()).toStrictEqual([]);
        });

        it('cancels the armed refresh on teardown', async () => {
            const teardown = await expiring(1_000_000 + 120_000).boot();

            teardown();

            expect(scheduler.delays()).toStrictEqual([]);
        });
    });

    describe('realtime', () => {
        it('connects the realtime connection for a hydrated session', async () => {
            const connection = createRecordingConnection();
            const target = persisted({}, { realtime: connection });

            await target.boot();

            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });
        });

        it('leaves the realtime connection alone while signed out', async () => {
            const connection = createRecordingConnection();

            await harness({}, { realtime: connection }).boot();

            expect(connection.calls).toStrictEqual([]);
        });

        it('disconnects an open connection when a 401 refresh fails, keeping the session', async () => {
            const connection = createRecordingConnection();
            const failure = new HttpError(422, 'malformed');
            const target = persisted({}, { realtime: connection });

            await target.boot();
            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });

            gateway.refresh.mockResolvedValueOnce({ kind: 'failed', error: failure });

            await expect(target.contributions.onUnauthorized?.()).resolves.toBe(false);
            expect(connection.calls).toStrictEqual(['connect', 'disconnect']);
            expect(target.observability.errors).toStrictEqual([failure]);
            expect(target.store().isAuthenticated).toBe(true);
        });

        it('leaves the realtime connection alone when it does not follow the session', async () => {
            const connection = createRecordingConnection();
            const target = persisted({ realtimeFollowsSession: false }, { realtime: connection });

            await target.boot();
            await target.store().clearLocal();

            expect(connection.calls).toStrictEqual([]);
        });
    });
});
