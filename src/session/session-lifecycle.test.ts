/**
 * Unit tests for the session lifecycle wired at the module's boot phase.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpRequest } from '@sinemacula/foundation/http/http-client';
import { HttpError, NetworkError } from '@sinemacula/foundation/http/http-error';
import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import { SessionError } from '@sinemacula/foundation/session/session-error';
import type { SessionTokens } from '@sinemacula/foundation/session/session-tokens';
import type { SessionUser } from '@sinemacula/foundation/session/session-user';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { resetWebCoreServices } from '../app/services';
import { IndexedDbSessionRecordStore } from '../storage/indexed-db-session-record-store';
import type { SessionModuleOptions } from './create-session-module';
import { createSessionModule } from './create-session-module';
import { resetSessionContext, sessionContext } from './session-context';
import type { FakeSessionApi, ManualScheduler } from './test-support/session-fixtures';
import {
    createFakeSessionApi,
    createManualScheduler,
    createRecordingConnection,
    deferred,
    LINEAGE,
    persistSnapshot,
    snapshot,
    tokens,
    user,
} from './test-support/session-fixtures';
import type { HarnessSetup, SessionHarness } from './test-support/session-harness';
import { createSessionHarness } from './test-support/session-harness';

const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;
const REQUEST: HttpRequest = { method: 'GET', url: '/x', headers: {}, body: undefined };

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
    async function persisted(options: SessionModuleOptions = {}, setup: HarnessSetup = {}): Promise<SessionHarness> {
        const target = harness(options, setup);

        await target.win.persist(tokens());
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
            const gate = deferred<string | null>();

            vi.spyOn(IndexedDbSessionRecordStore.prototype, 'read').mockReturnValueOnce(gate.promise);

            let booted = false;
            const booting = target.boot().then(teardown => {
                booted = true;

                return teardown;
            });

            await Promise.resolve();

            expect(booted).toBe(false);
            expect(target.win.listenerCount()).toBe(0);

            gate.resolve(null);
            await booting;

            expect(target.win.listenerCount()).toBe(1);
        });

        it('loads the user of a hydrated session once wired', async () => {
            const target = await persisted();

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
            const target = await persisted();
            const teardown = await target.boot();

            await vi.waitFor(() => {
                expect(target.store().user).not.toBeNull();
            });

            teardown();
            await target.store().clearLocal();

            expect(target.win.listenerCount()).toBe(0);
            expect(target.win.openChannels()).toBe(0);
            expect(target.pushes).toStrictEqual([]);
            expect(target.observability.resets).toStrictEqual([]);
        });
    });

    describe('session-loss redirect', () => {
        it('sends a lost session to the login route, carrying the current path', async () => {
            const target = await persisted();

            await target.boot();
            await target.store().clearLocal();

            await vi.waitFor(() => {
                expect(target.pushes).toStrictEqual([{ name: 'auth.login', query: { redirect: '/dashboard' } }]);
            });
        });

        it('carries no return target from the login page itself', async () => {
            const target = await persisted({}, { fullPath: '/login' });

            await target.boot();
            await target.store().clearLocal();

            await vi.waitFor(() => {
                expect(target.pushes).toStrictEqual([{ name: 'auth.login' }]);
            });
        });

        it('contains a rejected navigation', async () => {
            const target = await persisted({}, { pushRejection: new Error('navigation aborted') });

            await target.boot();
            await target.store().clearLocal();

            await vi.waitFor(() => {
                expect(target.pushes).toHaveLength(1);
            });
        });

        it('redirects when the boot user fetch finds the session refused', async () => {
            const target = await persisted();

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
            const target = await persisted({ sessionLossRedirect: false });

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

            await target.win.persist(tokens({ accessToken: 'other-tab' }), 5);
            gateway.currentUser.mockResolvedValueOnce(user({ id: 'u2' }));
            target.win.announce();

            await vi.waitFor(() => {
                expect(target.store().user?.id).toBe('u2');
            });
            expect(target.store().accessToken).toBe('other-tab');
        });

        it('signs out when another tab clears the session', async () => {
            const target = await persisted();

            await target.boot();

            await target.win.persist(null, 2);
            target.win.announce();

            await vi.waitFor(() => {
                expect(target.store().isAuthenticated).toBe(false);
            });
        });

        it.each([
            ['another key', { key: 'theme' }],
            ['another storage area', { key: 'auth.session', storageArea: {} as Storage }],
        ])('ignores a localStorage change to %s', async (_label, event) => {
            const target = harness();
            const read = vi.spyOn(IndexedDbSessionRecordStore.prototype, 'read');

            await target.boot();
            await settle();

            const reads = read.mock.calls.length;

            target.win.dispatchStorage(event);
            await settle();

            expect(read).toHaveBeenCalledTimes(reads);
            expect(target.win.navigator.locks?.names).toStrictEqual([]);
        });

        it('resynchronises on an announcement from another tab', async () => {
            const target = harness();
            const read = vi.spyOn(IndexedDbSessionRecordStore.prototype, 'read');

            await target.boot();
            await settle();

            const reads = read.mock.calls.length;

            target.win.announce();
            await settle();

            expect(read).toHaveBeenCalledTimes(reads + 1);
        });

        it.each([
            ['adopts a session persisted while', true, 'restored'],
            ['ignores', false, 'access'],
        ])('%s the page sat in the back-forward cache', async (_label, restored, expected) => {
            const target = await persisted();

            await target.boot();
            await target.win.persist(tokens({ accessToken: 'restored' }), 2);
            target.win.dispatchPageShow(restored);
            await settle();

            expect(target.store().accessToken).toBe(expected);
        });

        it('clears a session an earlier release writes in another tab, keeping the held one', async () => {
            const target = await persisted();

            await target.boot();

            persistSnapshot(target.win.localStorage, tokens({ accessToken: 'legacy' }), 3, 'lineage-legacy');
            target.win.dispatchStorage({ key: 'auth.session' });

            await vi.waitFor(() => {
                expect(JSON.parse(target.win.localStorage.getItem('auth.session') ?? '')).toStrictEqual(
                    snapshot(null, 4),
                );
            });
            expect(target.store().accessToken).toBe('access');
            expect(await target.win.record()).toStrictEqual(snapshot(tokens()));
        });

        it('adopts a session an earlier release writes in another tab before any is recorded', async () => {
            const target = harness();

            await target.boot();

            gateway.currentUser.mockResolvedValueOnce(user({ id: 'u2' }));
            persistSnapshot(target.win.localStorage, tokens({ accessToken: 'legacy' }), 3);
            target.win.dispatchStorage({ key: 'auth.session' });

            await vi.waitFor(() => {
                expect(target.store().user?.id).toBe('u2');
            });
            expect(target.store().accessToken).toBe('legacy');
        });

        it('adopts a session an earlier release wrote before the listener, while none is recorded', async () => {
            const target = harness();

            target.stores();
            await sessionContext().ready();
            persistSnapshot(target.win.localStorage, tokens({ accessToken: 'legacy' }));
            gateway.currentUser.mockResolvedValueOnce(user());

            await target.boot();

            expect(target.store().accessToken).toBe('legacy');
            expect(JSON.parse(target.win.localStorage.getItem('auth.session') ?? '')).toStrictEqual(snapshot(null, 2));
        });

        it('stops listening for legacy writes and restores once torn down', async () => {
            const target = harness();
            const teardown = await target.boot();

            teardown();
            persistSnapshot(target.win.localStorage, tokens(), 3);
            target.win.dispatchStorage({ key: 'auth.session' });
            await target.win.persist(tokens({ accessToken: 'restored' }));
            target.win.dispatchPageShow(true);
            await settle();

            expect(target.store().isAuthenticated).toBe(false);
            expect(target.win.localStorage.getItem('auth.session')).toBe(JSON.stringify(snapshot(tokens(), 3)));
        });

        it('listens for no legacy writes with a given persistence', async () => {
            const target = harness({ persistence: () => new KeyValueSessionPersistence(new MemoryStorage()) });

            await target.boot();

            persistSnapshot(target.win.localStorage, tokens(), 3);
            target.win.dispatchStorage({ key: 'auth.session' });
            await settle();

            expect(target.win.localStorage.getItem('auth.session')).toBe(JSON.stringify(snapshot(tokens(), 3)));
        });

        it('loads no user after a failed synchronisation', async () => {
            const target = harness();

            await target.win.persist(tokens());
            gateway.currentUser.mockRejectedValue(new NetworkError('offline'));
            await target.boot();
            await vi.waitFor(() => {
                expect(gateway.currentUser).toHaveBeenCalledTimes(1);
            });

            await target.win.persistRaw('not json');
            target.win.announce();

            await vi.waitFor(() => {
                expect(target.observability.errors).toHaveLength(1);
            });
            await settle();
            expect(gateway.currentUser).toHaveBeenCalledTimes(1);
        });

        it('reports a failed synchronisation and keeps the session', async () => {
            const target = await persisted();

            await target.boot();

            await target.win.persistRaw('not json');
            target.win.announce();

            await vi.waitFor(() => {
                expect(target.observability.errors).toHaveLength(1);
            });
            expect(target.store().isAuthenticated).toBe(true);
        });

        it('starts no user fetch once torn down mid-synchronisation', async () => {
            const target = harness();
            const teardown = await target.boot();
            const gate = deferred<string | null>();
            const read = vi.spyOn(IndexedDbSessionRecordStore.prototype, 'read').mockReturnValueOnce(gate.promise);

            target.win.announce();
            await vi.waitFor(() => {
                expect(read).toHaveBeenCalledOnce();
            });
            teardown();
            gate.resolve(JSON.stringify(snapshot(tokens(), 9, 'lineage-other')));

            await vi.waitFor(() => {
                expect(target.store().isAuthenticated).toBe(true);
            });
            expect(gateway.currentUser).not.toHaveBeenCalled();
        });

        it('catches a change persisted between the hydration and the listener', async () => {
            const target = harness();

            target.stores();
            await sessionContext().ready();
            await target.win.persist(tokens({ accessToken: 'during-boot' }), 3);
            gateway.currentUser.mockResolvedValueOnce(user());

            await target.boot();

            expect(target.store().accessToken).toBe('during-boot');
        });

        it('reports a failed reconciliation and still boots', async () => {
            const target = harness();

            await sessionContext().ready();
            await target.win.persistRaw('not json');

            await target.boot();

            expect(target.observability.errors).toHaveLength(1);
            expect(target.win.listenerCount()).toBe(1);
        });

        it('reports a cold boot over an unreadable session once, and a later sign-in heals it', async () => {
            const target = harness();

            await target.win.persistRaw('not json');
            await target.boot();

            expect(target.observability.errors).toHaveLength(1);
            expect(target.store().isAuthenticated).toBe(false);

            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
            gateway.currentUser.mockResolvedValueOnce(user());
            await target.store().login({ email: 'a', password: 'b' });

            expect(await target.win.record()).toStrictEqual({
                revision: 1,
                session: { lineage: expect.any(String), tokens: tokens() },
            });
        });

        it('boots signed out over a session stored in the previous format until a sign-in replaces it', async () => {
            const target = harness();

            await target.win.persistRaw(JSON.stringify({ revision: 4, tokens: tokens() }));
            await target.boot();

            expect(target.observability.errors).toStrictEqual([expect.any(SessionError)]);
            expect(target.store().isAuthenticated).toBe(false);
            expect(gateway.refresh).not.toHaveBeenCalled();

            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens({ accessToken: 'new' }) });
            gateway.currentUser.mockResolvedValueOnce(user());
            await target.store().login({ email: 'a', password: 'b' });

            expect(gateway.login).toHaveBeenCalledWith(
                { email: 'a', password: 'b' },
                { uuid: expect.any(String), os: 'WEB' },
                null,
            );
            expect(await target.win.record()).toStrictEqual({
                revision: 1,
                session: { lineage: expect.any(String), tokens: tokens({ accessToken: 'new' }) },
            });
        });

        it('reports a different hydration failure', async () => {
            const target = harness();

            vi.spyOn(IndexedDbSessionRecordStore.prototype, 'read')
                .mockRejectedValueOnce(new SessionError('unreadable'))
                .mockRejectedValueOnce(new DOMException('blocked', 'SecurityError'));
            await target.boot();

            expect(target.observability.errors).toHaveLength(2);
        });

        it('reports the same failure again once a hydration has succeeded', async () => {
            const target = harness();

            await target.win.persistRaw('not json');
            await target.boot();

            await target.win.persist(tokens(), 2);
            gateway.currentUser.mockResolvedValue(user());
            target.win.announce();
            await vi.waitFor(() => {
                expect(target.store().isAuthenticated).toBe(true);
            });

            await target.win.persistRaw('not json');
            target.win.announce();

            await vi.waitFor(() => {
                expect(target.observability.errors).toHaveLength(2);
            });
        });

        it('syncs a given persistence over a blocked localStorage', async () => {
            const target = harness(
                { persistence: () => new KeyValueSessionPersistence(new MemoryStorage()) },
                { storageBlocked: true },
            );

            await expect(target.boot()).resolves.toBeTypeOf('function');

            expect(target.win.listenerCount()).toBe(1);
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
            const read = vi.spyOn(IndexedDbSessionRecordStore.prototype, 'read');

            await target.boot();

            expect(target.win.listenerCount()).toBe(0);
            expect(read).toHaveBeenCalledTimes(1);
        });
    });

    describe('identity fan-out', () => {
        it('identifies the loaded user on every channel', async () => {
            const target = await persisted();

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

            await target.win.persist(tokens());
            gateway.currentUser.mockResolvedValue({ id: 7, email: null, name: null, permissions: [] });
            await target.boot();

            await vi.waitFor(() => {
                expect(target.observability.reportedUsers).toStrictEqual([{ id: '7' }]);
            });
        });

        it('clears every channel on sign-out', async () => {
            const target = await persisted();

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
            const target = await persisted({
                identity: { analytics: (signedIn: SessionUser) => `user-${signedIn.id}` },
            });

            await target.boot();

            await vi.waitFor(() => {
                expect(target.observability.identified).toStrictEqual(['user-u1']);
            });
            expect(target.observability.flagContexts).toStrictEqual([{ userId: 'u1' }]);
        });

        it('touches no channel when a session whose user never loaded ends', async () => {
            const target = harness();

            await target.win.persist(tokens());
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

            await target.win.persist(tokens());
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
            const target = await persisted({ identity: false });

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
                const target = await persisted(options);

                await target.boot();
                await vi.waitFor(() => {
                    expect(target.observability.identified).toStrictEqual(['u1']);
                });

                return target;
            }

            /**
             * Persist the given tokens as another tab's sign-in would, or its
             * rotation of the held session given its lineage, and announce it.
             */
            async function persistElsewhere(
                target: SessionHarness,
                persisted: SessionTokens | null,
                revision = 2,
                lineage = 'lineage-elsewhere',
            ): Promise<void> {
                await target.win.persist(persisted, revision, lineage);
                target.win.announce();
            }

            it('keeps the user, identity, channels and realtime connection when another tab rotates the session', async () => {
                const connection = createRecordingConnection();
                const target = await persisted({}, { realtime: connection });

                await target.boot();
                await vi.waitFor(() => {
                    expect(target.observability.identified).toStrictEqual(['u1']);
                });

                const identity = target.store().sessionIdentity();

                await persistElsewhere(
                    target,
                    tokens({ accessToken: 'rotated', refreshToken: 'rotated-refresh' }),
                    2,
                    LINEAGE,
                );

                await vi.waitFor(() => {
                    expect(target.store().accessToken).toBe('rotated');
                });
                await settle();

                expect(target.store().refreshToken).toBe('rotated-refresh');
                expect(target.store().user).toStrictEqual(user());
                expect(target.store().sessionIdentity()).toBe(identity);
                expect(gateway.currentUser).toHaveBeenCalledOnce();
                expect(target.observability.reportedUsers).toHaveLength(1);
                expect(target.observability.analyticsCalls).toStrictEqual(['identify u1']);
                expect(target.observability.flagContexts).toStrictEqual([{ userId: 'u1' }]);
                expect(connection.calls).toStrictEqual(['connect']);
            });

            it('touches no channel when another tab signs the same user in again', async () => {
                const target = await identified();

                await persistElsewhere(target, tokens({ accessToken: 'signed-in-again' }));

                await vi.waitFor(() => {
                    expect(gateway.currentUser).toHaveBeenCalledTimes(2);
                    expect(target.store().user).not.toBeNull();
                });
                await settle();

                expect(target.store().accessToken).toBe('signed-in-again');
                expect(target.observability.reportedUsers).toHaveLength(1);
                expect(target.observability.identified).toStrictEqual(['u1']);
                expect(target.observability.resets).toStrictEqual([]);
                expect(target.observability.flagContexts).toStrictEqual([{ userId: 'u1' }]);
            });

            it('resets before identifying a different user another tab signs in', async () => {
                const target = await identified();

                gateway.currentUser.mockResolvedValue(user({ id: 'u2', email: null, name: null }));
                await persistElsewhere(target, tokens({ accessToken: 'other-user' }));

                await vi.waitFor(() => {
                    expect(target.observability.analyticsCalls).toStrictEqual(['identify u1', 'reset', 'identify u2']);
                });
                expect(target.observability.reportedUsers.at(-1)).toStrictEqual({ id: 'u2' });
                expect(target.observability.flagContexts.at(-1)).toStrictEqual({ userId: 'u2' });
            });

            it('updates only the channels whose mapped value changed', async () => {
                const target = await identified();

                gateway.currentUser.mockResolvedValue(user({ name: 'Alice Jones' }));
                await persistElsewhere(target, tokens({ accessToken: 'signed-in-again' }));

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
                await persistElsewhere(target, tokens({ accessToken: 'signed-in-again' }));

                await vi.waitFor(() => {
                    expect(target.observability.reportedUsers).toHaveLength(2);
                });
                expect(target.observability.reportedUsers.at(-1)).toStrictEqual({ id: 'u1', name: 'Alice Smith' });
            });

            it('clears every channel when the adopted session user cannot be loaded', async () => {
                const target = await identified();

                gateway.currentUser.mockRejectedValue(new NetworkError('offline'));
                await persistElsewhere(target, tokens({ accessToken: 'signed-in-again' }));

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
                await persistElsewhere(target, tokens({ accessToken: 'first' }));
                await vi.waitFor(() => {
                    expect(gateway.currentUser).toHaveBeenCalledTimes(2);
                });
                await persistElsewhere(target, tokens({ accessToken: 'second' }), 3, 'lineage-third');
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
                const target = await persisted();
                const teardown = await target.boot();
                const loading = deferred<SessionUser>();

                await vi.waitFor(() => {
                    expect(target.observability.identified).toStrictEqual(['u1']);
                });
                gateway.currentUser.mockReturnValueOnce(loading.promise);
                await target.win.persist(tokens({ accessToken: 'signed-in-again' }), 2, 'lineage-elsewhere');
                target.win.announce();
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
                await persistElsewhere(target, tokens({ accessToken: 'signed-in-again' }));
                await vi.waitFor(() => {
                    expect(gateway.currentUser).toHaveBeenCalledTimes(2);
                });

                await persistElsewhere(target, null, 3);

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
        async function expiring(
            expiresAtEpochMs: number,
            options: SessionModuleOptions = {},
            setup: HarnessSetup = {},
        ): Promise<SessionHarness> {
            now = 1_000_000;
            scheduler = createManualScheduler();

            const target = harness(options, { clock: () => now, schedule: scheduler.schedule, ...setup });

            await target.win.persist(tokens({ expiresAtEpochMs }));
            gateway.currentUser.mockResolvedValue(user());

            return target;
        }

        beforeEach(() => {
            vi.spyOn(Math, 'random').mockReturnValue(0);
        });

        it('arms the refresh the skew ahead of expiry on the platform clock, then follows the new expiry', async () => {
            const target = await expiring(1_000_000 + 120_000);

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

            await (await expiring(1_000_000 + 120_000)).boot();

            expect(scheduler.delays()).toStrictEqual([delay]);
        });

        it('honours a custom skew', async () => {
            await (await expiring(1_000_000 + 10_000, { refreshSkewMs: 4_000 })).boot();

            expect(scheduler.delays()).toStrictEqual([6_000]);
        });

        it('refreshes at once inside the skew', async () => {
            const target = await expiring(1_000_000 + 1_000);

            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens() });
            await target.boot();

            expect(scheduler.delays()).toStrictEqual([0]);

            scheduler.flush();

            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalledTimes(1);
            });
        });

        it('disarms when the session ends', async () => {
            const target = await expiring(1_000_000 + 120_000);

            await target.boot();
            await target.store().clearLocal();
            await settle();

            expect(scheduler.delays()).toStrictEqual([]);
        });

        it('re-evaluates at the longest timer delay instead of overflowing', async () => {
            const target = await expiring(1_000_000 + MAX_TIMEOUT_DELAY_MS + 120_000);

            await target.boot();

            expect(scheduler.delays()).toStrictEqual([MAX_TIMEOUT_DELAY_MS]);

            now += MAX_TIMEOUT_DELAY_MS;
            scheduler.flush();

            expect(scheduler.delays()).toStrictEqual([60_000]);
            expect(gateway.refresh).not.toHaveBeenCalled();
        });

        it('arms the refresh itself at exactly the longest timer delay', async () => {
            const target = await expiring(1_000_000 + MAX_TIMEOUT_DELAY_MS + 60_000);

            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens() });
            await target.boot();

            expect(scheduler.delays()).toStrictEqual([MAX_TIMEOUT_DELAY_MS]);

            scheduler.flush();

            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalledTimes(1);
            });
        });

        it('keeps the session and arms nothing further when the proactive refresh fails transiently', async () => {
            const target = await expiring(1_000_000 + 1_000);

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
            const target = await expiring(1_000_000 + 1_000);

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
            const target = await expiring(1_000_000 + 120_000, {}, { realtime: connection });

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
            await (await expiring(1_000_000 + 1_000, { proactiveRefresh: false })).boot();

            expect(scheduler.delays()).toStrictEqual([]);
        });

        it('cancels the armed refresh on teardown', async () => {
            const teardown = await (await expiring(1_000_000 + 120_000)).boot();

            teardown();

            expect(scheduler.delays()).toStrictEqual([]);
        });

        it('arms nothing for a session that begins after teardown', async () => {
            const target = await expiring(1_000_000 + 120_000);
            const teardown = await target.boot();

            teardown();
            gateway.login.mockResolvedValueOnce({
                kind: 'authenticated',
                tokens: tokens({ expiresAtEpochMs: 1_000_000 + 300_000 }),
            });
            await target.store().login({ email: 'a', password: 'b' });
            await settle();

            expect(scheduler.delays()).toStrictEqual([]);
        });
    });

    describe('realtime', () => {
        it('connects the realtime connection for a hydrated session', async () => {
            const connection = createRecordingConnection();
            const target = await persisted({}, { realtime: connection });

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
            const target = await persisted({}, { realtime: connection });

            await target.boot();
            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });

            gateway.refresh.mockResolvedValueOnce({ kind: 'failed', error: failure });

            await expect(target.contributions.onUnauthorized?.(REQUEST)).resolves.toBe(false);
            expect(connection.calls).toStrictEqual(['connect', 'disconnect']);
            expect(target.observability.errors).toStrictEqual([failure]);
            expect(target.store().isAuthenticated).toBe(true);
        });

        it('leaves the realtime connection alone when it does not follow the session', async () => {
            const connection = createRecordingConnection();
            const target = await persisted({ realtimeFollowsSession: false }, { realtime: connection });

            await target.boot();
            await target.store().clearLocal();

            expect(connection.calls).toStrictEqual([]);
        });
    });
});
