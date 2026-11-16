/**
 * Unit tests for the session lifecycle wired at the module's boot phase.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '@sinemacula/foundation/http/http-error';
import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import type { SessionSnapshot } from '@sinemacula/foundation/session/session-persistence';
import type { SessionUser } from '@sinemacula/foundation/session/session-user';
import { resetWebCoreServices } from '../app/services';
import type { SessionModuleOptions } from './create-session-module';
import { createSessionModule } from './create-session-module';
import { resetSessionContext, sessionContext } from './session-context';
import type { FakeSessionApi } from './test-support/session-fixtures';
import {
    createFakeSessionApi,
    createRecordingConnection,
    deferred,
    persistSnapshot,
    tokens,
    user,
} from './test-support/session-fixtures';
import type { HarnessSetup, SessionHarness } from './test-support/session-harness';
import { createSessionHarness } from './test-support/session-harness';

const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;

describe('session lifecycle', () => {
    let gateway: FakeSessionApi;

    /**
     * Register the module over the fake gateway.
     *
     * @param options - module options
     * @param setup - harness seams
     * @returns the harness
     */
    function harness(options: SessionModuleOptions = {}, setup: HarnessSetup = {}): SessionHarness {
        return createSessionHarness(createSessionModule({ api: () => gateway, ...options }), setup);
    }

    /**
     * Register over a persisted session whose user loads, without booting.
     *
     * @param options - module options
     * @param setup - harness seams
     * @returns the harness
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
        vi.useRealTimers();
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

        it('redirects a session the user fetch finds refused, the watcher being in place first', async () => {
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

        it('ignores other keys and other storage areas', async () => {
            const target = harness();
            const load = vi.spyOn(KeyValueSessionPersistence.prototype, 'load');

            await target.boot();

            const loads = load.mock.calls.length;

            target.win.dispatchStorage({ key: 'theme' });
            target.win.dispatchStorage({ key: 'auth.session', storageArea: {} as Storage });
            target.win.dispatchStorage({ key: null, storageArea: null });

            expect(load).toHaveBeenCalledTimes(loads);
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

        it('fans nothing out when disabled', async () => {
            const target = persisted({ identity: false });

            await target.boot();
            await vi.waitFor(() => {
                expect(target.store().user).not.toBeNull();
            });

            expect(target.observability.identified).toStrictEqual([]);
        });
    });

    describe('proactive refresh', () => {
        /**
         * Register over a persisted session expiring at the given instant, on
         * fake timers with the platform clock on fake time.
         *
         * @param expiresAtEpochMs - the persisted expiry
         * @param options - module options
         * @returns the harness
         */
        function expiring(expiresAtEpochMs: number, options: SessionModuleOptions = {}): SessionHarness {
            vi.useFakeTimers({ now: 1_000_000 });

            const target = harness(options, { clock: () => Date.now() });

            persistSnapshot(target.win.localStorage, tokens({ expiresAtEpochMs }));
            gateway.currentUser.mockResolvedValue(user());

            return target;
        }

        it('refreshes the skew ahead of expiry on the platform clock, then follows the new expiry', async () => {
            const target = expiring(1_000_000 + 120_000);

            gateway.refresh
                .mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens({ expiresAtEpochMs: 1_000_000 + 300_000 }) })
                .mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens() });
            await target.boot();

            await vi.advanceTimersByTimeAsync(59_999);
            expect(gateway.refresh).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            expect(gateway.refresh).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(239_999 - 60_000);
            expect(gateway.refresh).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(1);
            expect(gateway.refresh).toHaveBeenCalledTimes(2);
        });

        it('honours a custom skew', async () => {
            const target = expiring(1_000_000 + 10_000, { refreshSkewMs: 4_000 });

            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens() });
            await target.boot();

            await vi.advanceTimersByTimeAsync(5_999);
            expect(gateway.refresh).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            expect(gateway.refresh).toHaveBeenCalledTimes(1);
        });

        it('refreshes at once inside the skew', async () => {
            const target = expiring(1_000_000 + 1_000);

            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens() });
            await target.boot();
            await vi.advanceTimersByTimeAsync(0);

            expect(gateway.refresh).toHaveBeenCalledTimes(1);
        });

        it('disarms when the session ends', async () => {
            const target = expiring(1_000_000 + 120_000);

            await target.boot();
            await target.store().clearLocal();
            await vi.advanceTimersByTimeAsync(120_000);

            expect(gateway.refresh).not.toHaveBeenCalled();
        });

        it('re-evaluates at the longest timer delay instead of overflowing', async () => {
            const target = expiring(1_000_000 + MAX_TIMEOUT_DELAY_MS + 120_000);

            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens() });
            await target.boot();

            await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_DELAY_MS);
            expect(gateway.refresh).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(60_000);
            expect(gateway.refresh).toHaveBeenCalledTimes(1);
        });

        it('redirects when the proactive refresh is refused', async () => {
            const target = expiring(1_000_000 + 1_000);

            gateway.refresh.mockResolvedValueOnce({ kind: 'rejected', error: new HttpError(401, 'refused') });
            await target.boot();
            await vi.advanceTimersByTimeAsync(0);

            expect(target.store().isAuthenticated).toBe(false);
            expect(target.pushes).toStrictEqual([{ name: 'auth.login', query: { redirect: '/dashboard' } }]);
        });

        it('arms nothing when disabled', async () => {
            const target = expiring(1_000_000 + 1_000, { proactiveRefresh: false });

            await target.boot();
            await vi.advanceTimersByTimeAsync(120_000);

            expect(gateway.refresh).not.toHaveBeenCalled();
        });

        it('cancels the armed refresh on teardown', async () => {
            const target = expiring(1_000_000 + 120_000);
            const teardown = await target.boot();

            teardown();
            await vi.advanceTimersByTimeAsync(120_000);

            expect(gateway.refresh).not.toHaveBeenCalled();
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

        it('leaves the realtime connection alone when it does not follow the session', async () => {
            const connection = createRecordingConnection();
            const target = persisted({ realtimeFollowsSession: false }, { realtime: connection });

            await target.boot();
            await target.store().clearLocal();

            expect(connection.calls).toStrictEqual([]);
        });
    });
});
