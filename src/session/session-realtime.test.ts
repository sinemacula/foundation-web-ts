/**
 * Unit tests for the realtime connection policy over the session.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError, NetworkError } from '@sinemacula/foundation/http/http-error';
import { RealtimeError } from '@sinemacula/foundation/realtime/realtime-error';
import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import type { RefreshOutcome, RefreshResult } from '@sinemacula/foundation/session/session-outcomes';
import type { SessionTokens } from '@sinemacula/foundation/session/session-tokens';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { installRealtime, resetFoundationWebServices } from '../app/services';
import { EventSourceConnection } from '../realtime/event-source-connection';
import type { ModuleTeardown } from '../module/module';
import type { SessionContext } from './session-context';
import { installSessionContext, resetSessionContext, sessionContext } from './session-context';
import { followSession, sessionReconnectGuard } from './session-realtime';
import { SessionRefreshCoordinator } from './session-refresh-coordinator';
import type { SessionStore } from './session-store';
import { useSessionStore } from './session-store';
import type { FakeSessionApi, ManualScheduler, RecordingConnection } from './test-support/session-fixtures';
import {
    createFakeSessionApi,
    createManualScheduler,
    createRecordingConnection,
    createTestSessionContext,
    deferred,
    persistSnapshot,
    tokens,
    user,
} from './test-support/session-fixtures';
import type { Observability } from './test-support/session-harness';
import { installObservability } from './test-support/session-harness';

const NOW = 1_000_000;
const SKEW = 60_000;

describe('session realtime policy', () => {
    let storage: MemoryStorage;
    let gateway: FakeSessionApi;
    let connection: RecordingConnection;
    let scheduler: ManualScheduler;
    let observability: Observability;

    /**
     * Install the session context over the test storage and gateway.
     */
    function install(overrides: Partial<SessionContext> = {}): void {
        installSessionContext(
            createTestSessionContext({
                persistence: new KeyValueSessionPersistence(storage),
                api: gateway,
                clock: () => NOW,
                schedule: scheduler.schedule,
                refreshSkewMs: SKEW,
                ...overrides,
            }),
        );
    }

    /**
     * Persist and hydrate a session expiring at the given instant, if known.
     */
    async function hydrated(expiresAtEpochMs: number | null): Promise<SessionStore> {
        persistSnapshot(storage, tokens({ expiresAtEpochMs }));

        const store = useSessionStore();

        await store.hydrate();

        return store;
    }

    /**
     * Adopt a session another tab signed in over whatever is held.
     */
    async function adoptElsewhere(adopted: SessionTokens): Promise<void> {
        persistSnapshot(storage, adopted, 10, 'lineage-elsewhere');
        await useSessionStore().hydrate();
    }

    /**
     * Sign a new session in over whatever is held.
     */
    async function signIn(signedIn: SessionTokens): Promise<void> {
        gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: signedIn });
        gateway.currentUser.mockResolvedValueOnce(user());
        await useSessionStore().login({ email: 'a', password: 'b' });
    }

    beforeEach(() => {
        storage = new MemoryStorage();
        gateway = createFakeSessionApi();
        connection = createRecordingConnection();
        scheduler = createManualScheduler();
        observability = installObservability();
        setActivePinia(createPinia());
        install();
        installRealtime(connection);
    });

    afterEach(() => {
        resetSessionContext();
        resetFoundationWebServices();
    });

    describe('sessionReconnectGuard', () => {
        /**
         * Run one reconnect check against the given connection, or the
         * installed one.
         */
        function check(target?: RecordingConnection): Promise<unknown> {
            return (target === undefined ? sessionReconnectGuard() : sessionReconnectGuard(() => target))(
                new AbortController().signal,
            );
        }

        it('decides only once the session has hydrated', async () => {
            const ready = deferred<undefined>();

            resetSessionContext();
            install({ ready: () => ready.promise });
            persistSnapshot(storage, tokens());

            const verdict = check();

            await useSessionStore().hydrate();
            ready.resolve(undefined);

            await expect(verdict).resolves.toBe(true);
        });

        it('lets a current session reconnect without refreshing', async () => {
            await hydrated(NOW + SKEW + 1);

            await expect(check()).resolves.toBe(true);
            expect(gateway.refresh).not.toHaveBeenCalled();
            expect(connection.calls).toStrictEqual([]);
        });

        it('treats an unknown expiry as current', async () => {
            await hydrated(null);

            await expect(check()).resolves.toBe(true);
            expect(gateway.refresh).not.toHaveBeenCalled();
        });

        it('stops the installed connection when signed out', async () => {
            await expect(check()).resolves.toBe(false);
            expect(connection.calls).toStrictEqual(['disconnect']);
        });

        it('stops the connection it guards', async () => {
            const guarded = createRecordingConnection();

            await expect(check(guarded)).resolves.toBe(false);
            expect(guarded.calls).toStrictEqual(['disconnect']);
            expect(connection.calls).toStrictEqual([]);
        });

        it('refreshes a session expiring within the skew, then reconnects', async () => {
            await hydrated(NOW + SKEW);
            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens({ expiresAtEpochMs: null }) });

            await expect(check()).resolves.toBe(true);
            expect(gateway.refresh).toHaveBeenCalledTimes(1);
        });

        it('skips the attempt for backoff to retry when the refresh fails transiently', async () => {
            await hydrated(NOW);
            gateway.refresh.mockResolvedValueOnce({ kind: 'retryable', error: new NetworkError('offline') });

            await expect(check()).resolves.toBe(false);
            expect(connection.calls).toStrictEqual([]);
        });

        it.each<[string, RefreshResult]>([
            ['rejected', { kind: 'rejected', error: new HttpError(401, 'refused') }],
            ['interactionRequired', { kind: 'interactionRequired', pending: { credential: 'p', requires: ['mfa'] } }],
            ['failed', { kind: 'failed', error: new HttpError(422, 'malformed') }],
        ])('stops the connection on a %s refresh', async (_kind, result) => {
            await hydrated(NOW);
            gateway.refresh.mockResolvedValueOnce(result);

            await expect(check()).resolves.toBe(false);
            expect(connection.calls).toStrictEqual(['disconnect']);
        });

        it('stops the connection when signed out during the refresh', async () => {
            await hydrated(NOW);

            const pending = deferred<RefreshResult>();

            gateway.refresh.mockReturnValueOnce(pending.promise);

            const verdict = check();

            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalled();
            });

            const signingOut = useSessionStore().logout();

            pending.resolve({ kind: 'refreshed', tokens: tokens({ accessToken: 'discarded' }) });

            await expect(verdict).resolves.toBe(false);
            await signingOut;
            expect(connection.calls).toStrictEqual(['disconnect']);
        });

        it('reconnects on a current session another tab signed in during the refresh, not on the discarded one', async () => {
            await hydrated(NOW);

            const pending = deferred<RefreshResult>();

            gateway.refresh.mockReturnValueOnce(pending.promise);

            const verdict = check();

            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalled();
            });
            await adoptElsewhere(tokens({ accessToken: 'signed-in', expiresAtEpochMs: null }));
            pending.resolve({ kind: 'refreshed', tokens: tokens({ accessToken: 'discarded' }) });

            await expect(verdict).resolves.toBe(true);
            expect(useSessionStore().accessToken).toBe('signed-in');
        });

        it('skips without refreshing again when the session another tab signed in during the refresh is expiring', async () => {
            await hydrated(NOW);

            const pending = deferred<RefreshResult>();

            gateway.refresh.mockReturnValueOnce(pending.promise);

            const verdict = check();

            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalled();
            });
            await adoptElsewhere(tokens({ accessToken: 'signed-in', expiresAtEpochMs: NOW }));
            pending.resolve({ kind: 'refreshed', tokens: tokens() });

            await expect(verdict).resolves.toBe(false);
            expect(gateway.refresh).toHaveBeenCalledTimes(1);
            expect(connection.calls).toStrictEqual([]);
        });

        it('rechecks the session after a refresh that landed', async () => {
            await hydrated(NOW);
            resetSessionContext();
            install({
                coordinator: new SessionRefreshCoordinator(async (): Promise<RefreshOutcome> => {
                    await useSessionStore().clearLocal();

                    return { kind: 'refreshed' };
                }),
            });

            await expect(check()).resolves.toBe(false);
            expect(connection.calls).toStrictEqual(['disconnect']);
        });

        it('trusts a refresh that landed even when the new expiry is within the skew', async () => {
            await hydrated(NOW);
            resetSessionContext();
            install({
                coordinator: new SessionRefreshCoordinator(() => Promise.resolve({ kind: 'refreshed' })),
            });

            await expect(check()).resolves.toBe(true);
        });

        it('skips without judging the session an attempt abandoned before it hydrated', async () => {
            const controller = new AbortController();

            await hydrated(NOW);
            controller.abort();

            await expect(sessionReconnectGuard()(controller.signal)).resolves.toBe(false);
            expect(gateway.refresh).not.toHaveBeenCalled();
            expect(connection.calls).toStrictEqual([]);
        });

        it('skips without disconnecting an attempt abandoned during a refused refresh', async () => {
            const controller = new AbortController();
            const pending = deferred<RefreshResult>();

            await hydrated(NOW);
            gateway.refresh.mockReturnValueOnce(pending.promise);

            const verdict = sessionReconnectGuard()(controller.signal);

            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalled();
            });
            controller.abort();
            pending.resolve({ kind: 'rejected', error: new HttpError(401, 'refused') });

            await expect(verdict).resolves.toBe(false);
            expect(connection.calls).toStrictEqual([]);
        });

        it('skips without disconnecting when another tab signed in as a refused refresh settled', async () => {
            await hydrated(NOW);
            resetSessionContext();
            install({
                coordinator: new SessionRefreshCoordinator(async (): Promise<RefreshOutcome> => {
                    await adoptElsewhere(tokens({ accessToken: 'signed-in', expiresAtEpochMs: null }));

                    return { kind: 'rejected', error: new HttpError(401, 'refused') };
                }),
            });

            await expect(check()).resolves.toBe(false);
            expect(connection.calls).toStrictEqual([]);
        });
    });

    describe('followSession', () => {
        let teardowns: ModuleTeardown[];

        /**
         * Follow the session with the test connection until the test ends.
         */
        function follow(store: SessionStore): ModuleTeardown {
            const teardown = followSession(connection, store);

            teardowns.push(teardown);

            return teardown;
        }

        /**
         * Settle every pending promise and zero-delay timer.
         */
        async function settle(): Promise<void> {
            await new Promise(resolve => {
                setTimeout(resolve, 0);
            });
        }

        beforeEach(() => {
            teardowns = [];
        });

        afterEach(() => {
            for (const teardown of teardowns) {
                teardown();
            }
        });

        it('retries a connect skipped on a transient refresh failure, backing off between attempts', async () => {
            const store = await hydrated(NOW);
            const offline: RefreshResult = { kind: 'retryable', error: new NetworkError('offline') };

            gateway.refresh
                .mockResolvedValueOnce(offline)
                .mockResolvedValueOnce(offline)
                .mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens({ expiresAtEpochMs: null }) });
            follow(store);

            await vi.waitFor(() => {
                expect(scheduler.delays()).toStrictEqual([1_000]);
            });
            expect(gateway.refresh).toHaveBeenCalledTimes(1);

            scheduler.flush();
            await vi.waitFor(() => {
                expect(scheduler.delays()).toStrictEqual([2_000]);
            });
            expect(gateway.refresh).toHaveBeenCalledTimes(2);
            expect(connection.calls).toStrictEqual([]);

            scheduler.flush();
            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });
            expect(gateway.refresh).toHaveBeenCalledTimes(3);
            expect(scheduler.delays()).toStrictEqual([]);
        });

        it('connects a skipped session once a refresh elsewhere renews it', async () => {
            const store = await hydrated(NOW);

            gateway.refresh.mockResolvedValueOnce({ kind: 'retryable', error: new NetworkError('offline') });
            follow(store);
            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalledTimes(1);
            });
            await settle();

            gateway.refresh.mockResolvedValueOnce({
                kind: 'refreshed',
                tokens: tokens({ accessToken: 'rotated', expiresAtEpochMs: null }),
            });
            await store.refresh();

            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });
            expect(gateway.refresh).toHaveBeenCalledTimes(2);
        });

        it('leaves a skipped connect to a connection already open when the session rotates', async () => {
            const store = await hydrated(NOW);

            connection.state = 'open';
            gateway.refresh.mockResolvedValueOnce({ kind: 'retryable', error: new NetworkError('offline') });
            follow(store);
            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalledTimes(1);
            });
            await settle();

            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens({ accessToken: 'rotated' }) });
            await store.refresh();
            await settle();

            expect(connection.calls).toStrictEqual([]);
        });

        it('keeps an open connection through a rotation', async () => {
            const store = await hydrated(null);

            follow(store);
            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });

            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens({ accessToken: 'rotated' }) });
            await store.refresh();
            await settle();

            expect(connection.calls).toStrictEqual(['connect']);
        });

        it('leaves a connection it opened that has since closed alone through a rotation', async () => {
            const store = await hydrated(null);

            follow(store);
            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });

            connection.state = 'closed';
            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens({ accessToken: 'rotated' }) });
            await store.refresh();
            await settle();

            expect(connection.calls).toStrictEqual(['connect']);
        });

        it('restarts the backoff for a new session after earlier skips', async () => {
            const store = await hydrated(NOW);

            gateway.refresh.mockResolvedValue({ kind: 'retryable', error: new NetworkError('offline') });
            follow(store);
            await vi.waitFor(() => {
                expect(scheduler.delays()).toStrictEqual([1_000]);
            });
            scheduler.flush();
            await vi.waitFor(() => {
                expect(scheduler.delays()).toStrictEqual([2_000]);
            });

            await adoptElsewhere(tokens({ accessToken: 'signed-in', expiresAtEpochMs: NOW }));

            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalledTimes(3);
            });
            await settle();

            expect(scheduler.delays()).toStrictEqual([1_000]);
        });

        it('retries instead of connecting when the session another tab signed in during the refresh is expiring', async () => {
            const store = await hydrated(NOW);
            const pending = deferred<RefreshResult>();

            gateway.refresh.mockReturnValueOnce(pending.promise);
            follow(store);
            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalled();
            });

            await adoptElsewhere(tokens({ accessToken: 'signed-in', expiresAtEpochMs: NOW }));
            pending.resolve({ kind: 'refreshed', tokens: tokens() });
            await settle();

            expect(gateway.refresh).toHaveBeenCalledTimes(1);
            expect(connection.calls).toStrictEqual(['disconnect']);
            expect(scheduler.delays()).toStrictEqual([1_000]);
        });

        it.each([
            ['other tokens', tokens({ accessToken: 'other', expiresAtEpochMs: null })],
            ['the same tokens', tokens({ expiresAtEpochMs: null })],
        ])('reconnects for a session signed in over the held one with %s', async (_label, signedIn) => {
            const store = await hydrated(null);

            follow(store);
            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });

            await signIn(signedIn);

            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect', 'disconnect', 'connect']);
            });
        });

        it('reconnects for a session another tab signed in over the held one with the same tokens', async () => {
            const store = await hydrated(null);

            follow(store);
            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });

            await adoptElsewhere(tokens({ expiresAtEpochMs: null }));

            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect', 'disconnect', 'connect']);
            });
        });

        it.each([
            [
                'torn down',
                (teardown: ModuleTeardown): Promise<void> => {
                    teardown();

                    return Promise.resolve();
                },
            ],
            ['signed out', (): Promise<void> => useSessionStore().clearLocal()],
        ])('stops retrying once %s', async (_label, end) => {
            const store = await hydrated(NOW);

            gateway.refresh.mockResolvedValue({ kind: 'retryable', error: new NetworkError('offline') });

            const teardown = follow(store);

            await vi.waitFor(() => {
                expect(scheduler.delays()).toStrictEqual([1_000]);
            });
            await end(teardown);

            await vi.waitFor(() => {
                expect(scheduler.delays()).toStrictEqual([]);
            });
            expect(gateway.refresh).toHaveBeenCalledTimes(1);
        });

        it.each<[string, RefreshResult, boolean]>([
            ['refused', { kind: 'rejected', error: new HttpError(401, 'refused') }, false],
            [
                'returned to pending authentication',
                { kind: 'interactionRequired', pending: { credential: 'p', requires: ['mfa'] } },
                false,
            ],
            ['failed', { kind: 'failed', error: new HttpError(422, 'malformed') }, true],
        ])(
            'stops an open connection and its pending retry when a refresh elsewhere is %s',
            async (_label, result, kept) => {
                const store = await hydrated(NOW);

                connection.state = 'open';
                gateway.refresh
                    .mockResolvedValueOnce({ kind: 'retryable', error: new NetworkError('offline') })
                    .mockResolvedValueOnce(result);
                follow(store);
                await vi.waitFor(() => {
                    expect(scheduler.delays()).toStrictEqual([1_000]);
                });

                await sessionContext().coordinator.refresh();
                await settle();

                expect(connection.state).toBe('closed');
                expect(connection.calls).not.toContain('connect');
                expect(scheduler.delays()).toStrictEqual([]);
                expect(store.isAuthenticated).toBe(kept);
            },
        );

        it('keeps a connection stopped by a failed refresh down through a later rotation', async () => {
            const store = await hydrated(NOW);

            gateway.refresh
                .mockResolvedValueOnce({ kind: 'retryable', error: new NetworkError('offline') })
                .mockResolvedValueOnce({ kind: 'failed', error: new HttpError(422, 'malformed') })
                .mockResolvedValueOnce({
                    kind: 'refreshed',
                    tokens: tokens({ accessToken: 'rotated', expiresAtEpochMs: null }),
                });
            follow(store);
            await vi.waitFor(() => {
                expect(scheduler.delays()).toStrictEqual([1_000]);
            });

            await sessionContext().coordinator.refresh();
            await sessionContext().coordinator.refresh();
            await settle();

            expect(store.accessToken).toBe('rotated');
            expect(connection.calls).toStrictEqual(['disconnect']);
        });

        it('disconnects once when its own refresh fails', async () => {
            const store = await hydrated(NOW);

            gateway.refresh.mockResolvedValueOnce({ kind: 'failed', error: new HttpError(422, 'malformed') });
            follow(store);
            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalledTimes(1);
            });
            await settle();

            expect(connection.calls).toStrictEqual(['disconnect']);
            expect(store.isAuthenticated).toBe(true);
        });

        it('ignores refresh failures once torn down', async () => {
            const store = await hydrated(null);

            connection.state = 'open';
            follow(store)();
            gateway.refresh.mockResolvedValueOnce({ kind: 'failed', error: new HttpError(422, 'malformed') });

            await sessionContext().coordinator.refresh();

            expect(connection.calls).toStrictEqual([]);
        });

        it('disconnects the connection it connected once torn down', async () => {
            const store = await hydrated(null);
            const teardown = follow(store);

            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });
            teardown();

            expect(connection.calls).toStrictEqual(['connect', 'disconnect']);
        });

        it('leaves a connection it found active connected once torn down', async () => {
            const store = await hydrated(null);

            connection.state = 'connecting';

            const teardown = follow(store);

            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });
            teardown();

            expect(connection.calls).toStrictEqual(['connect']);
        });

        it('leaves a connection it disconnected alone once torn down', async () => {
            const store = await hydrated(null);
            const teardown = follow(store);

            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });
            await store.clearLocal();
            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect', 'disconnect']);
            });
            teardown();

            expect(connection.calls).toStrictEqual(['connect', 'disconnect']);
        });

        it('connects at once for a held session', async () => {
            const store = await hydrated(null);

            follow(store);

            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });
        });

        it('leaves the connection alone while signed out', async () => {
            follow(useSessionStore());
            await Promise.resolve();

            expect(connection.calls).toStrictEqual([]);
        });

        it('disconnects when the session ends and connects when one begins', async () => {
            const store = await hydrated(null);

            follow(store);
            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });

            await store.clearLocal();
            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect', 'disconnect']);
            });

            await signIn(tokens());
            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect', 'disconnect', 'connect']);
            });
        });

        it('refreshes an expiring session before connecting', async () => {
            const store = await hydrated(NOW);

            gateway.refresh.mockImplementationOnce(() => {
                expect(connection.calls).toStrictEqual([]);

                return Promise.resolve({ kind: 'refreshed', tokens: tokens() });
            });
            follow(store);

            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['connect']);
            });
            expect(gateway.refresh).toHaveBeenCalledTimes(1);
        });

        it('reports a connection that cannot open', async () => {
            const store = await hydrated(null);
            const failure = new RealtimeError('Cannot connect.');

            connection.connect = () => {
                throw failure;
            };
            follow(store);

            await vi.waitFor(() => {
                expect(observability.errors).toStrictEqual([failure]);
            });
        });

        it('abandons a pending connect and stops following once torn down', async () => {
            const store = await hydrated(NOW);
            const pending = deferred<RefreshResult>();

            gateway.refresh.mockReturnValueOnce(pending.promise);

            const teardown = follow(store);

            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalled();
            });
            teardown();
            pending.resolve({ kind: 'refreshed', tokens: tokens() });
            await vi.waitFor(() => {
                expect(store.expiresAtEpochMs).toBeNull();
            });
            await store.clearLocal();
            await Promise.resolve();

            expect(connection.calls).toStrictEqual([]);
        });

        it('lets only the latest transition act when signing out and in during a pending refresh', async () => {
            const store = await hydrated(NOW);
            const pending = deferred<RefreshResult>();

            gateway.refresh.mockReturnValueOnce(pending.promise);
            follow(store);
            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalled();
            });

            const signingOut = store.logout();

            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['disconnect']);
            });

            pending.resolve({ kind: 'rejected', error: new HttpError(401, 'refused') });
            await signingOut;
            await settle();

            expect(connection.calls).toStrictEqual(['disconnect']);

            await signIn(tokens({ expiresAtEpochMs: null }));

            await vi.waitFor(() => {
                expect(connection.calls).toStrictEqual(['disconnect', 'connect']);
            });
            expect(store.isAuthenticated).toBe(true);
        });
    });

    describe('over an EventSource connection', () => {
        /** Every EventSource the connection opened. */
        let sources: EventSource[];

        /** The connection under test, guarded and followed. */
        let sse: EventSourceConnection;

        /** Stops following the session. */
        let unfollow: ModuleTeardown;

        /**
         * Follow a current session with a guarded connection, let the session
         * near its expiry, then fail the open source so the connection
         * schedules a reconnect.
         */
        async function dropped(): Promise<SessionStore> {
            let now = NOW;

            resetSessionContext();
            install({ clock: () => now });

            const store = await hydrated(NOW + 2 * SKEW);

            sse = new EventSourceConnection({
                url: () => `/stream?token=${store.accessToken ?? ''}`,
                eventSourceFactory: url => {
                    const source = { url, close: () => undefined, addEventListener: () => undefined } as unknown;

                    sources.push(source as EventSource);

                    return source as EventSource;
                },
                beforeReconnect: sessionReconnectGuard(() => sse),
            });
            unfollow = followSession(sse, store);
            await vi.advanceTimersByTimeAsync(0);
            now += SKEW;
            sources[0]?.onerror?.(new Event('error'));

            return store;
        }

        beforeEach(() => {
            vi.useFakeTimers();
            sources = [];
        });

        afterEach(() => {
            unfollow();
            vi.useRealTimers();
        });

        it('reopens on the rotated token once the refresh lands', async () => {
            await dropped();

            gateway.refresh.mockResolvedValueOnce({
                kind: 'refreshed',
                tokens: tokens({ accessToken: 'rotated', expiresAtEpochMs: null }),
            });
            await vi.runOnlyPendingTimersAsync();

            expect(sources.map(source => source.url)).toStrictEqual(['/stream?token=access', '/stream?token=rotated']);
            expect(sse.state).toBe('connecting');
            expect(vi.getTimerCount()).toBe(0);
        });

        it('keeps the reconnect pending when the refresh fails transiently', async () => {
            await dropped();

            gateway.refresh.mockResolvedValueOnce({ kind: 'retryable', error: new NetworkError('offline') });
            await vi.runOnlyPendingTimersAsync();

            expect(sources).toHaveLength(1);
            expect(sse.state).toBe('connecting');
            expect(vi.getTimerCount()).toBe(1);
            expect(scheduler.delays()).toStrictEqual([]);
        });

        it('stops for good, with nothing pending, when the refresh is refused', async () => {
            const store = await dropped();

            gateway.refresh.mockResolvedValueOnce({ kind: 'rejected', error: new HttpError(401, 'refused') });
            await vi.runOnlyPendingTimersAsync();

            expect(store.isAuthenticated).toBe(false);
            expect(sources).toHaveLength(1);
            expect(sse.state).toBe('closed');
            expect(vi.getTimerCount()).toBe(0);
            expect(scheduler.delays()).toStrictEqual([]);
        });
    });
});
