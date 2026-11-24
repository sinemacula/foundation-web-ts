/**
 * Unit tests for createSessionModule's register and stores phases and typing.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Store } from 'pinia';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { FetchHttpClient } from '@sinemacula/foundation/http/fetch-http-client';
import type { HttpClient, HttpRequest, UnauthorizedHandler } from '@sinemacula/foundation/http/http-client';
import { ApiErrorCode, HttpError, NetworkError } from '@sinemacula/foundation/http/http-error';
import { InProcessSessionLock } from '@sinemacula/foundation/session/in-process-session-lock';
import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import { RecordSessionPersistence } from '@sinemacula/foundation/session/record-session-persistence';
import type { SessionApi } from '@sinemacula/foundation/session/session-api';
import { SessionError } from '@sinemacula/foundation/session/session-error';
import { FakeAuthServer } from '@sinemacula/foundation/session/test-support/fake-auth-server';
import type { RefreshResult } from '@sinemacula/foundation/session/session-outcomes';
import type { SessionPersistence, SessionSnapshot } from '@sinemacula/foundation/session/session-persistence';
import type { SessionState } from '@sinemacula/foundation/session/session-state';
import type { SessionUser } from '@sinemacula/foundation/session/session-user';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { installApi, resetFoundationWebServices } from '../app/services';
import { CookieSupport } from '../cookies/cookie-support';
import { createCookieWindow } from '../cookies/test-support/cookie-window';
import { IndexedDbSessionRecordStore } from '../storage/indexed-db-session-record-store';
import type { SessionModuleOptions } from './create-session-module';
import { createSessionModule } from './create-session-module';
import { resetSessionContext, sessionContext } from './session-context';
import type { FakeSessionApi } from './test-support/session-fixtures';
import {
    createFakeSessionApi,
    deferred,
    persistSnapshot,
    SESSION_KEY,
    snapshot,
    tokens,
    user,
} from './test-support/session-fixtures';
import type { HarnessSetup, SessionHarness } from './test-support/session-harness';
import { createHttpClientStub, createSessionHarness } from './test-support/session-harness';

const REQUEST: HttpRequest = { method: 'GET', url: '/x', headers: {}, body: undefined };

/** The registered module and the real HTTP client carrying its contributions. */
interface WiredSession {
    /** The registered module. */
    readonly target: SessionHarness;

    /** The HTTP client the default gateway sends through. */
    readonly http: HttpClient;
}

describe('createSessionModule', () => {
    let gateway: FakeSessionApi;

    /**
     * Register the module over the fake gateway.
     */
    function harness(options: SessionModuleOptions = {}, setup: HarnessSetup = {}): SessionHarness {
        return createSessionHarness(createSessionModule({ api: () => gateway, ...options }), setup);
    }

    /**
     * Run the contributed interceptors over a bare request.
     */
    async function intercept(target: SessionHarness): Promise<HttpRequest> {
        let request = REQUEST;

        for (const interceptor of target.contributions.requestInterceptors) {
            request = await interceptor(request);
        }

        return request;
    }

    /**
     * Resolve the unauthorized handler the module claimed.
     */
    function unauthorizedHandler(target: SessionHarness): UnauthorizedHandler {
        const handler = target.contributions.onUnauthorized;

        if (handler === null) {
            throw new Error('The session module must claim the unauthorized handler.');
        }

        return handler;
    }

    /**
     * Run the contributed unauthorized handler as a 401 does, resolving whether
     * the request is retried.
     */
    function retries(target: SessionHarness): Promise<boolean> {
        return unauthorizedHandler(target)(REQUEST);
    }

    beforeEach(() => {
        gateway = createFakeSessionApi();
    });

    afterEach(() => {
        resetFoundationWebServices();
        resetSessionContext();
    });

    describe('module shape', () => {
        it('is named session, with no routes, locales or fallback and one store', () => {
            const module = createSessionModule();

            expect(module.name).toBe('session');
            expect(module.routes).toStrictEqual([]);
            expect(module.locales).toBeUndefined();
            expect(module.fallback).toBeUndefined();
            expect(module.stores).toHaveLength(1);
        });

        it('honours a custom registry name', () => {
            expect(createSessionModule({ name: 'auth-session' }).name).toBe('auth-session');
        });
    });

    describe('session context', () => {
        it('installs the default route identity, store id, skew and the platform clock', () => {
            const target = harness({}, { clock: () => 42 });

            expect(sessionContext().routes).toStrictEqual({
                login: { name: 'auth.login' },
                loginPath: '/login',
                home: '/',
                forbidden: '/forbidden',
            });
            expect(sessionContext().storeId).toBe('auth');
            expect(sessionContext().refreshSkewMs).toBe(60_000);
            expect(sessionContext().clock).toBe(target.platform.clock);
        });

        it('merges route overrides and honours a custom store id and skew', () => {
            const target = harness({
                routes: { login: { name: 'sign-in' }, loginPath: '/sign-in' },
                storeId: 'session-custom',
                refreshSkewMs: 5_000,
            });

            expect(sessionContext().routes).toStrictEqual({
                login: { name: 'sign-in' },
                loginPath: '/sign-in',
                home: '/',
                forbidden: '/forbidden',
            });
            expect(sessionContext().refreshSkewMs).toBe(5_000);
            expect((target.store() as unknown as Record<'$id', string>).$id).toBe('session-custom');
        });
    });

    describe('persistence', () => {
        it('persists a fresh lineage in an IndexedDB record named after the key, exchanging under a Web Locks lock', async () => {
            const target = harness();

            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
            gateway.currentUser.mockResolvedValueOnce(user());

            await target.store().login({ email: 'a', password: 'b' });

            const stored = (await target.win.record()) as SessionSnapshot;

            expect(stored).toStrictEqual({ revision: 1, session: { lineage: expect.any(String), tokens: tokens() } });
            expect(target.win.navigator.locks?.names).toStrictEqual(['auth.session:exchange']);
            expect(target.win.localStorage.getItem(SESSION_KEY)).toBeNull();

            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
            gateway.currentUser.mockResolvedValueOnce(user());
            await target.store().login({ email: 'a', password: 'b' });

            expect(await target.win.record()).not.toHaveProperty('session.lineage', stored.session?.lineage);
        });

        it('follows an overridden session key for the record and the lock', async () => {
            const target = harness({ storageKeys: { session: 'app.session' } });
            const record = new IndexedDbSessionRecordStore(target.win.indexedDB, 'app.session');

            await record.swap(() => JSON.stringify(snapshot(tokens(), 3)));
            await sessionContext().ready();

            expect(target.store().accessToken).toBe('access');

            await target.store().logout();

            expect(target.win.navigator.locks?.names).toStrictEqual(['app.session:exchange']);
            await expect(record.read()).resolves.toBe(JSON.stringify(snapshot(null, 4)));
        });

        it('runs every exchange under the given exchange lock, built over the platform', async () => {
            const lock = new InProcessSessionLock();
            const run = vi.spyOn(lock, 'run');
            const factory = vi.fn(() => lock);
            const target = harness({ exchangeLock: factory });

            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
            gateway.currentUser.mockResolvedValueOnce(user());
            await target.store().login({ email: 'a', password: 'b' });

            expect(factory).toHaveBeenCalledWith(target.platform);
            expect(run).toHaveBeenCalledOnce();
            expect(target.win.navigator.locks?.names).toStrictEqual([]);
        });

        it('keeps the exchanges of a given persistence to this tab unless an exchange lock is given', async () => {
            const target = harness({ persistence: () => new KeyValueSessionPersistence(new MemoryStorage()) });

            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
            gateway.currentUser.mockResolvedValueOnce(user());
            await target.store().login({ email: 'a', password: 'b' });

            expect(target.store().isAuthenticated).toBe(true);
            expect(target.win.navigator.locks?.names).toStrictEqual([]);
            expect(sessionContext()).not.toHaveProperty('exchangeLock');
        });

        it('runs the exchanges of a given persistence under a given exchange lock', async () => {
            const lock = new InProcessSessionLock();
            const run = vi.spyOn(lock, 'run');
            const target = harness({
                persistence: () => new KeyValueSessionPersistence(new MemoryStorage()),
                exchangeLock: () => lock,
            });

            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
            gateway.currentUser.mockResolvedValueOnce(user());
            await target.store().login({ email: 'a', password: 'b' });

            expect(run).toHaveBeenCalledOnce();
            expect(target.win.navigator.locks?.names).toStrictEqual([]);
        });

        it('rejects a sign-in whose storage write fails', async () => {
            const target = harness();
            const failure = new DOMException('quota', 'QuotaExceededError');

            vi.spyOn(IndexedDbSessionRecordStore.prototype, 'swap').mockRejectedValue(failure);
            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });

            await expect(target.store().login({ email: 'a', password: 'b' })).rejects.toBe(failure);
            expect(target.store().isAuthenticated).toBe(false);
        });

        it('refuses to register without Web Locks unless a persistence is given', () => {
            expect(() => harness({}, { withoutLocks: true })).toThrowError(
                new SessionError(
                    'The session module needs the Web Locks API to share the persisted session across tabs; ' +
                        'pass the persistence option where it is unavailable.',
                ),
            );
        });

        it.each<[string, HarnessSetup]>([
            ['a blocked localStorage with Web Locks', { storageBlocked: true }],
            ['a blocked localStorage without Web Locks', { storageBlocked: true, withoutLocks: true }],
            ['a blocked IndexedDB', { indexedDbBlocked: true }],
            ['a missing IndexedDB', { withoutIndexedDb: true }],
        ])('keeps the session in memory for the page over %s', async (_label, setup) => {
            const target = harness({}, setup);

            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
            gateway.currentUser.mockResolvedValueOnce(user());
            await target.store().login({ email: 'a', password: 'b' });
            await target.store().hydrate();

            expect(target.store().accessToken).toBe('access');
            expect(target.win.navigator.locks?.names ?? []).toStrictEqual([]);
            expect(target.win.openChannels()).toBe(0);
            expect(target.observability.warnings).toStrictEqual([
                'Site storage is blocked, so the session is kept in memory: it ends on reload and is not shared with other tabs.',
            ]);
            expect(target.observability.errors).toStrictEqual([]);
        });

        it('warns of nothing when site storage is reachable', () => {
            const target = harness();

            expect(target.observability.warnings).toStrictEqual([]);
        });

        it('surfaces a write failure of the given persistence over blocked storage', async () => {
            const failure = new Error('secure store unavailable');
            const inner = new KeyValueSessionPersistence(new MemoryStorage());
            const target = harness(
                {
                    persistence: () => ({
                        load: () => inner.load(),
                        saveIf: () => Promise.reject(failure),
                        clearIf: revision => inner.clearIf(revision),
                    }),
                    crossTabSync: false,
                },
                { storageBlocked: true },
            );

            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });

            await expect(target.store().login({ email: 'a', password: 'b' })).rejects.toBe(failure);
            expect(target.store().isAuthenticated).toBe(false);
            expect(target.observability.warnings).toStrictEqual([]);
        });

        it('surfaces a failure of the given persistence rather than falling back', () => {
            const failure = new Error('secure store unavailable');

            expect(() =>
                harness(
                    {
                        persistence: () => {
                            throw failure;
                        },
                    },
                    { storageBlocked: true },
                ),
            ).toThrowError(failure);
        });

        it('uses the given persistence instead, built over the platform', async () => {
            const storage = new MemoryStorage();
            const factory = vi.fn(() => new KeyValueSessionPersistence(storage));
            const target = harness({ persistence: factory }, { withoutLocks: true });

            persistSnapshot(storage, tokens({ accessToken: 'custom' }));
            await sessionContext().ready();

            expect(factory).toHaveBeenCalledWith(target.platform);
            expect(target.store().accessToken).toBe('custom');
            await expect(target.win.record()).resolves.toBeNull();
        });

        it('announces each committed write of the given persistence to the other tabs', async () => {
            const target = harness({ persistence: () => new KeyValueSessionPersistence(new MemoryStorage()) });
            const other = new target.win.BroadcastChannel(SESSION_KEY);
            const announced = vi.fn();

            other.addEventListener('message', announced);
            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
            gateway.currentUser.mockResolvedValueOnce(user());
            await target.store().login({ email: 'a', password: 'b' });

            await vi.waitFor(() => {
                expect(announced).toHaveBeenCalledOnce();
            });
        });

        it('opens no channel when cross-tab sync is disabled', async () => {
            const target = harness({ crossTabSync: false }, { withoutBroadcastChannel: true });

            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
            gateway.currentUser.mockResolvedValueOnce(user());
            await target.store().login({ email: 'a', password: 'b' });

            expect(target.store().isAuthenticated).toBe(true);
            expect(target.win.openChannels()).toBe(0);
            expect(sessionContext().persistence).toBeInstanceOf(RecordSessionPersistence);
        });

        it('refuses to register without BroadcastChannel while cross-tab sync is on', () => {
            expect(() => harness({}, { withoutBroadcastChannel: true })).toThrowError(
                new SessionError(
                    'Cross-tab session sync needs the BroadcastChannel API; set crossTabSync to false where it is unavailable.',
                ),
            );
        });
    });

    describe('legacy localStorage snapshot', () => {
        it('adopts a session an earlier release persisted, then clears it from localStorage', async () => {
            const target = harness();

            persistSnapshot(target.win.localStorage, tokens({ accessToken: 'legacy' }), 4);
            await sessionContext().ready();

            expect(target.store().accessToken).toBe('legacy');
            expect(await target.win.record()).toStrictEqual(snapshot(tokens({ accessToken: 'legacy' })));
            expect(JSON.parse(target.win.localStorage.getItem(SESSION_KEY) ?? '')).toStrictEqual(snapshot(null, 5));
            expect(target.win.navigator.locks?.names).toStrictEqual(['auth.session:exchange', 'auth.session:lock']);
        });

        it('waits for an exchange an earlier release has in flight before adopting its session', async () => {
            const target = harness();
            const exchange = deferred<undefined>();

            persistSnapshot(target.win.localStorage, tokens({ accessToken: 'spent' }));

            const earlierRelease = target.win.navigator.locks?.request('auth.session:exchange', async () => {
                await exchange.promise;
                persistSnapshot(target.win.localStorage, tokens({ accessToken: 'rotated' }), 2);
            });
            const ready = sessionContext().ready();

            exchange.resolve(undefined);
            await earlierRelease;
            await ready;

            expect(target.store().accessToken).toBe('rotated');
        });

        it('retires the legacy session before an exchange that awaits readiness takes the lock', async () => {
            const target = harness();

            persistSnapshot(target.win.localStorage, tokens({ accessToken: 'legacy' }));
            gateway.login.mockImplementationOnce(async () => {
                await sessionContext().ready();

                return { kind: 'authenticated', tokens: tokens({ accessToken: 'signed-in' }) };
            });
            gateway.currentUser.mockResolvedValueOnce(user());

            await expect(target.store().login({ email: 'a', password: 'b' })).resolves.toStrictEqual({
                kind: 'superseded',
            });
            expect(target.win.navigator.locks?.names).toStrictEqual([
                'auth.session:exchange',
                'auth.session:lock',
                'auth.session:exchange',
            ]);
        });

        it('keeps the record once written, clearing a later legacy session without adopting it', async () => {
            const target = harness();

            await target.win.persist(null, 2);
            persistSnapshot(target.win.localStorage, tokens({ accessToken: 'legacy' }), 4);
            await sessionContext().ready();

            expect(target.store().isAuthenticated).toBe(false);
            expect(await target.win.record()).toStrictEqual(snapshot(null, 2));
            expect(JSON.parse(target.win.localStorage.getItem(SESSION_KEY) ?? '')).toStrictEqual(snapshot(null, 5));
        });

        it('clears an unreadable legacy snapshot without reporting it', async () => {
            const target = harness();

            target.win.localStorage.setItem(SESSION_KEY, 'not json');
            await sessionContext().ready();

            expect(JSON.parse(target.win.localStorage.getItem(SESSION_KEY) ?? '')).toStrictEqual(snapshot(null, 1));
            expect(target.observability.errors).toStrictEqual([]);
        });

        it('leaves an empty legacy snapshot alone', async () => {
            const target = harness();

            persistSnapshot(target.win.localStorage, null, 3);
            await sessionContext().ready();

            expect(target.win.localStorage.getItem(SESSION_KEY)).toBe(JSON.stringify(snapshot(null, 3)));
            expect(target.win.navigator.locks?.names).toStrictEqual([]);
        });

        it('reports a failed retirement and still hydrates', async () => {
            const target = harness();
            const failure = new DOMException('quota', 'QuotaExceededError');

            await target.win.persist(tokens({ accessToken: 'current' }));
            persistSnapshot(target.win.localStorage, tokens({ accessToken: 'legacy' }));
            vi.spyOn(target.win.localStorage, 'setItem').mockImplementation(() => {
                throw failure;
            });
            await sessionContext().ready();

            expect(target.store().accessToken).toBe('current');
            expect(target.observability.errors).toStrictEqual([failure]);
        });

        it('announces an adopted legacy session to the other tabs', async () => {
            const target = harness();
            const other = new target.win.BroadcastChannel(SESSION_KEY);
            const announced = vi.fn();

            other.addEventListener('message', announced);
            persistSnapshot(target.win.localStorage, tokens());
            await sessionContext().ready();

            await vi.waitFor(() => {
                expect(announced).toHaveBeenCalledOnce();
            });
        });

        it('touches no legacy snapshot with a given persistence', async () => {
            const target = harness({ persistence: () => new KeyValueSessionPersistence(new MemoryStorage()) });

            persistSnapshot(target.win.localStorage, tokens());
            await sessionContext().ready();

            expect(target.store().isAuthenticated).toBe(false);
            expect(target.win.localStorage.getItem(SESSION_KEY)).toBe(JSON.stringify(snapshot(tokens())));
        });
    });

    describe('readiness', () => {
        it('hydrates once, however often readiness is awaited', async () => {
            const target = harness();
            const load = vi.spyOn(IndexedDbSessionRecordStore.prototype, 'read');

            await target.win.persist(tokens());
            await Promise.all([sessionContext().ready(), sessionContext().ready()]);

            expect(load).toHaveBeenCalledTimes(1);
            expect(target.store().isAuthenticated).toBe(true);
        });

        it('reports a hydration failure and settles signed out', async () => {
            const target = harness();

            await target.win.persistRaw('not json');

            await expect(sessionContext().ready()).resolves.toBeUndefined();
            expect(target.observability.errors).toHaveLength(1);
            expect(target.observability.errors[0]).toBeInstanceOf(SessionError);
            expect(target.store().isAuthenticated).toBe(false);
        });

        it('starts hydrating at the stores phase', async () => {
            const target = harness();

            await target.win.persist(tokens());
            target.stores();

            await vi.waitFor(() => {
                expect(target.store().isAuthenticated).toBe(true);
            });
        });
    });

    describe('bearer interceptor', () => {
        it('contributes one request interceptor, the unauthorized handler and no response-error handler', () => {
            const target = harness();

            expect(target.contributions.requestInterceptors).toHaveLength(1);
            expect(target.contributions.responseErrorHandlers).toHaveLength(0);
            expect(target.contributions.onUnauthorized).not.toBeNull();
        });

        it('attaches the hydrated access token, waiting for hydration', async () => {
            const target = harness();

            await target.win.persist(tokens({ accessToken: 'tok-123' }));

            await expect(intercept(target)).resolves.toStrictEqual({
                ...REQUEST,
                headers: { authorization: 'Bearer tok-123' },
            });
        });

        it('leaves the request untouched when signed out', async () => {
            await expect(intercept(harness())).resolves.toBe(REQUEST);
        });
    });

    describe('unauthorized handler', () => {
        /**
         * Register over a hydrated persisted session.
         */
        async function signedIn(): Promise<SessionHarness> {
            const target = harness();

            await target.win.persist(tokens());
            await sessionContext().ready();

            return target;
        }

        it('retries the request once the session is refreshed', async () => {
            const target = await signedIn();

            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens({ accessToken: 'fresh' }) });

            await expect(retries(target)).resolves.toBe(true);
            expect(gateway.refresh).toHaveBeenCalledWith('refresh');
            expect(target.store().accessToken).toBe('fresh');
            expect(target.observability.errors).toStrictEqual([]);
        });

        it.each<[string, RefreshResult]>([
            ['retryable', { kind: 'retryable', error: new NetworkError('offline') }],
            ['rejected', { kind: 'rejected', error: new HttpError(401, 'refused') }],
            ['interactionRequired', { kind: 'interactionRequired', pending: { credential: 'p', requires: ['mfa'] } }],
        ])('neither retries nor reports a %s refresh', async (_kind, result) => {
            const target = await signedIn();

            gateway.refresh.mockResolvedValueOnce(result);

            await expect(retries(target)).resolves.toBe(false);
            expect(target.observability.errors).toStrictEqual([]);
        });

        it('does not retry a refresh another transition overtook', async () => {
            const target = await signedIn();
            const pending = deferred<RefreshResult>();

            gateway.refresh.mockReturnValueOnce(pending.promise);

            const retried = retries(target);

            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalled();
            });
            await target.store().clearLocal();
            pending.resolve({ kind: 'refreshed', tokens: tokens({ accessToken: 'discarded' }) });

            await expect(retried).resolves.toBe(false);
            expect(target.store().accessToken).toBeNull();
        });

        it('ends renewal on a refusal of the session it refreshed', async () => {
            const target = await signedIn();
            const error = new HttpError(401, 'refused');
            const halted = vi.fn();

            gateway.refresh.mockResolvedValueOnce({ kind: 'rejected', error });
            sessionContext().coordinator.onTerminal(halted);

            await expect(sessionContext().coordinator.refresh()).resolves.toStrictEqual({ kind: 'rejected', error });
            expect(halted).toHaveBeenCalledOnce();
            expect(target.store().isAuthenticated).toBe(false);
        });

        it('leaves clearing a refused session to the core, clearing it once', async () => {
            const target = await signedIn();
            const clearIf = vi.spyOn(RecordSessionPersistence.prototype, 'clearIf');

            gateway.refresh.mockResolvedValueOnce({ kind: 'rejected', error: new HttpError(401, 'refused') });

            await retries(target);

            expect(clearIf).toHaveBeenCalledTimes(1);
            expect(target.store().isAuthenticated).toBe(false);
        });

        it('retries a request sent with a session token since replaced without refreshing again', async () => {
            const target = await signedIn();
            const sent = await intercept(target);

            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens({ accessToken: 'fresh' }) });
            await retries(target);

            await expect(unauthorizedHandler(target)(sent)).resolves.toBe(true);
            expect(gateway.refresh).toHaveBeenCalledOnce();
        });

        it.each<[string, HttpRequest]>([
            ['a bearer the session never sent', { ...REQUEST, headers: { authorization: 'Bearer other' } }],
            ['another authorization scheme', { ...REQUEST, headers: { authorization: 'Basic access' } }],
        ])('refreshes for a request sent with %s', async (_case, request) => {
            const target = await signedIn();

            gateway.refresh.mockResolvedValue({ kind: 'refreshed', tokens: tokens({ accessToken: 'fresh' }) });
            await intercept(target);
            await retries(target);

            await expect(unauthorizedHandler(target)(request)).resolves.toBe(true);
            expect(gateway.refresh).toHaveBeenCalledTimes(2);
        });

        it('refreshes for a request that brought its own session token, even once it is replaced', async () => {
            const target = await signedIn();
            const sent = { ...REQUEST, headers: { authorization: 'Bearer access' } };

            await expect(target.contributions.requestInterceptors[0]?.(sent)).resolves.toBe(sent);
            gateway.refresh.mockResolvedValue({ kind: 'refreshed', tokens: tokens({ accessToken: 'fresh' }) });
            await retries(target);

            await expect(unauthorizedHandler(target)(sent)).resolves.toBe(true);
            expect(gateway.refresh).toHaveBeenCalledTimes(2);
        });

        it('refreshes for a request sent with the current session token', async () => {
            const target = await signedIn();
            const sent = await intercept(target);

            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens({ accessToken: 'fresh' }) });

            await expect(unauthorizedHandler(target)(sent)).resolves.toBe(true);
            expect(gateway.refresh).toHaveBeenCalledOnce();
        });

        it('does not retry a replaced session token once signed out', async () => {
            const target = await signedIn();
            const sent = await intercept(target);

            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens({ accessToken: 'fresh' }) });
            await retries(target);
            await target.store().clearLocal();

            await expect(unauthorizedHandler(target)(sent)).resolves.toBe(false);
            expect(gateway.refresh).toHaveBeenCalledOnce();
        });

        it('retries on the session a sign-in installed while the refresh was pending', async () => {
            const target = await signedIn();
            const sent = await intercept(target);
            const pending = deferred<RefreshResult>();

            gateway.refresh.mockReturnValueOnce(pending.promise);

            const retried = unauthorizedHandler(target)(sent);

            await vi.waitFor(() => {
                expect(gateway.refresh).toHaveBeenCalled();
            });
            gateway.login.mockResolvedValueOnce({
                kind: 'authenticated',
                tokens: tokens({ accessToken: 'signed-in' }),
            });
            gateway.currentUser.mockResolvedValueOnce(user());

            const signingIn = target.store().login({ email: 'a', password: 'b' });

            pending.resolve({ kind: 'refreshed', tokens: tokens({ accessToken: 'discarded' }) });

            await expect(signingIn).resolves.toStrictEqual({ kind: 'authenticated' });
            await expect(retried).resolves.toBe(true);
            expect(target.store().accessToken).toBe('signed-in');
        });

        it('reports a refusal that settles after another sign-in replaced the session as superseded', async () => {
            const target = await signedIn();
            const error = new HttpError(401, 'refused');

            gateway.refresh.mockResolvedValueOnce({ kind: 'rejected', error });
            const store = target.store() as unknown as Store<'auth', SessionState>;

            store.$onAction(({ name, after }) => {
                if (name === 'refresh') {
                    after(() => {
                        store.$patch({ accessToken: 'signed-in-elsewhere' });
                    });
                }
            });

            const halted = vi.fn();

            sessionContext().coordinator.onTerminal(halted);

            await expect(sessionContext().coordinator.refresh()).resolves.toStrictEqual({ kind: 'superseded' });
            expect(halted).not.toHaveBeenCalled();
        });

        it('reports a failed refresh once, without retrying, and keeps the session', async () => {
            const target = await signedIn();
            const error = new HttpError(422, 'malformed');

            gateway.refresh.mockResolvedValueOnce({ kind: 'failed', error });

            await expect(retries(target)).resolves.toBe(false);
            expect(target.observability.errors).toStrictEqual([error]);
            expect(target.store().accessToken).toBe('access');
        });

        it('single-flights concurrent refreshes', async () => {
            const target = await signedIn();

            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens() });

            await expect(Promise.all([retries(target), retries(target)])).resolves.toStrictEqual([true, true]);
            expect(gateway.refresh).toHaveBeenCalledTimes(1);
        });

        it('waits for hydration before refreshing', async () => {
            const storage = new MemoryStorage();
            const inner = new KeyValueSessionPersistence(storage);
            const gate = deferred<undefined>();
            const persistence: SessionPersistence = {
                load: async () => {
                    await gate.promise;

                    return inner.load();
                },
                saveIf: (revision, saved) => inner.saveIf(revision, saved),
                clearIf: revision => inner.clearIf(revision),
            };
            const target = harness({ persistence: () => persistence });

            persistSnapshot(storage, tokens({ refreshToken: 'persisted-refresh' }));
            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens() });
            target.stores();

            const retried = retries(target);

            await Promise.resolve();
            expect(gateway.refresh).not.toHaveBeenCalled();

            gate.resolve(undefined);

            await expect(retried).resolves.toBe(true);
            expect(gateway.refresh).toHaveBeenCalledWith('persisted-refresh');
        });

        it('keeps a rotated pair it could not persist, reports the failure and sends the rotated token', async () => {
            const target = await signedIn();
            const failure = new DOMException('quota', 'QuotaExceededError');

            vi.spyOn(IndexedDbSessionRecordStore.prototype, 'swap').mockRejectedValueOnce(failure);
            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens({ accessToken: 'rotated' }) });

            await expect(retries(target)).resolves.toBe(false);
            expect(target.observability.errors).toStrictEqual([failure]);
            await expect(intercept(target)).resolves.toHaveProperty('headers', { authorization: 'Bearer rotated' });
        });
    });

    describe('refused refresh cookies', () => {
        const now = 1_000_000;

        /** A refresh refused because it arrived without the refresh cookie. */
        const missingCookie = (): RefreshResult => ({
            kind: 'rejected',
            error: new HttpError(401, 'Unauthenticated.', null, { code: ApiErrorCode.RefreshCookieMissing }),
        });

        /**
         * Register over a hydrated session whose access token expires at the
         * given time, with cookie support whose check passed.
         */
        async function hydrated(expiresAtEpochMs: number | null): Promise<{
            /** The registered module. */
            target: SessionHarness;

            /** The cookie support the booted application provides. */
            support: CookieSupport;
        }> {
            const support = new CookieSupport({ targetWindow: createCookieWindow().targetWindow });
            const target = harness({}, { clock: () => now, cookieSupport: support });

            await target.win.persist(tokens({ expiresAtEpochMs }));
            await sessionContext().ready();

            return { target, support };
        }

        it('blocks cookies when a live session refreshes without its cookie', async () => {
            const { target, support } = await hydrated(now + 1);
            const teardown = await target.boot();

            gateway.refresh.mockResolvedValueOnce(missingCookie());

            await expect(sessionContext().coordinator.refresh()).resolves.toMatchObject({ kind: 'rejected' });
            expect(support.accepted).toBe(false);

            teardown();
        });

        it('holds a refusal from before boot until the cookie support attaches', async () => {
            const { target, support } = await hydrated(now + 1);

            gateway.refresh.mockResolvedValueOnce(missingCookie());
            await sessionContext().coordinator.refresh();

            expect(support.accepted).toBe(true);

            const teardown = await target.boot();

            expect(support.accepted).toBe(false);

            teardown();
        });

        it.each([
            ['the access token had expired', now],
            ['the access token expiry is unknown', null],
        ])('leaves cookies accepted when %s, as the cookie may have expired with it', async (_, expiresAt) => {
            const { target, support } = await hydrated(expiresAt);

            gateway.refresh.mockResolvedValueOnce(missingCookie());
            await sessionContext().coordinator.refresh();

            const teardown = await target.boot();

            expect(support.accepted).toBe(true);

            teardown();
        });

        it('leaves cookies accepted for an ordinary refusal', async () => {
            const { target, support } = await hydrated(now + 1);

            gateway.refresh.mockResolvedValueOnce({ kind: 'rejected', error: new HttpError(401, 'Unauthenticated.') });
            await sessionContext().coordinator.refresh();

            const teardown = await target.boot();

            expect(support.accepted).toBe(true);

            teardown();
        });

        it('blocks cookies after signing in to a server whose cookie the browser refuses', async () => {
            const server = new FakeAuthServer({ now: () => now, transport: 'cookie', cookiesBlocked: true });
            const support = new CookieSupport({ targetWindow: createCookieWindow().targetWindow });
            const target = createSessionHarness(
                createSessionModule({ api: () => server.api({ accessToken: () => target.store().accessToken }) }),
                { clock: () => now, cookieSupport: support },
            );
            const teardown = await target.boot();

            await expect(
                target.store().login({ email: 'alice@example.com', password: 'secret' }),
            ).resolves.toStrictEqual({
                kind: 'authenticated',
            });
            await sessionContext().coordinator.refresh();

            expect(support.accepted).toBe(false);
            expect(target.store().isAuthenticated).toBe(false);

            teardown();
        });

        it('leaves cookies accepted when another sign-in replaced the session meanwhile', async () => {
            const { target, support } = await hydrated(now + 1);
            const store = target.store() as unknown as Store<'auth', SessionState>;

            gateway.refresh.mockResolvedValueOnce(missingCookie());
            store.$onAction(({ name, after }) => {
                if (name === 'refresh') {
                    after(() => {
                        store.$patch({ accessToken: 'signed-in-elsewhere' });
                    });
                }
            });

            await expect(sessionContext().coordinator.refresh()).resolves.toStrictEqual({ kind: 'superseded' });

            const teardown = await target.boot();

            expect(support.accepted).toBe(true);

            teardown();
        });
    });

    describe('session API gateway', () => {
        it('builds the default gateway lazily over the installed HTTP client, once', () => {
            createSessionHarness(createSessionModule());
            resetFoundationWebServices();

            expect(() => sessionContext().api).toThrowError('http client accessed before initialisation');

            installApi(createHttpClientStub());

            expect(sessionContext().api).toBe(sessionContext().api);
        });

        it('computes the default gateway expiry on the platform clock', async () => {
            const target = createSessionHarness(createSessionModule(), { clock: () => 1_000 });
            const http: HttpClient = {
                ...createHttpClientStub(),
                post: <T>() =>
                    Promise.resolve({ access_token: 'a', refresh_token: 'r', expires_in: 60 } as unknown as T),
                get: <T>() => Promise.resolve({ id: 7 } as unknown as T),
            };

            installApi(http);

            await expect(target.store().login({ email: 'a', password: 'b' })).resolves.toStrictEqual({
                kind: 'authenticated',
            });
            expect(target.store().expiresAtEpochMs).toBe(61_000);
        });

        it('passes the installed HTTP client to a custom gateway factory', () => {
            const factory = vi.fn((_http: HttpClient) => gateway);

            createSessionHarness(createSessionModule({ api: factory }));

            const installed = createHttpClientStub();

            installApi(installed);

            expect(sessionContext().api).toBe(gateway);
            expect(factory).toHaveBeenCalledWith(installed);
        });
    });

    describe('over the HTTP client', () => {
        /** Every exchange the server saw, as method, path and bearer. */
        let exchanges: string[];

        /** How the fake server answers a refresh. */
        let refreshResponse: () => Response;

        /** Responses held back until released, keyed by path. */
        let holds: Map<string, Promise<void>>;

        /**
         * Answer the fake server's routes: a user only for the fresh token, and
         * a refresh as scripted, each once any hold on its path is released.
         */
        const server = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const method = init?.method ?? 'GET';
            const path = new URL(String(input)).pathname;
            const bearer = new Headers(init?.headers).get('authorization');
            const hold = holds.get(path);

            exchanges.push(`${method} ${path} ${bearer ?? '-'}`);
            holds.delete(path);
            await hold;

            if (path === '/auth/refresh') {
                return refreshResponse();
            }

            if (path.startsWith('/users/') && bearer === 'Bearer fresh') {
                return Response.json({ id: 'u1', email: null, name: null, permissions: [] });
            }

            return new Response('expired', { status: 401 });
        };

        /**
         * Register the default gateway over a real HTTP client carrying the
         * module's contributions, over a persisted session.
         */
        async function wired(): Promise<WiredSession> {
            const target = createSessionHarness(createSessionModule());
            const http = new FetchHttpClient({
                baseUrl: 'https://api.example',
                fetchFn: server,
                requestInterceptors: target.contributions.requestInterceptors,
                onUnauthorized: unauthorizedHandler(target),
            });

            installApi(http);
            await target.win.persist(tokens());
            await sessionContext().ready();

            return { target, http };
        }

        beforeEach(() => {
            exchanges = [];
            holds = new Map();
            refreshResponse = () =>
                Response.json({ access_token: 'fresh', refresh_token: 'fresh-refresh', expires_in: 3_600 });
        });

        it('refreshes on a 401 and retries the request with the rotated token', async () => {
            const { target, http } = await wired();

            await expect(http.get('users/self')).resolves.toHaveProperty('id', 'u1');
            expect(exchanges).toStrictEqual([
                'GET /users/self Bearer access',
                'POST /auth/refresh Bearer access',
                'GET /users/self Bearer fresh',
            ]);
            expect(target.store().refreshToken).toBe('fresh-refresh');
            expect(await target.win.record()).toHaveProperty('session.tokens.accessToken', 'fresh');
        });

        it('retries a late 401 for a request sent before a completed refresh without refreshing again', async () => {
            const { http } = await wired();
            const release = deferred<undefined>();

            holds.set('/users/slow', release.promise);

            const slow = http.get('users/slow');

            await vi.waitFor(() => {
                expect(exchanges).toStrictEqual(['GET /users/slow Bearer access']);
            });
            await http.get('users/self');
            release.resolve(undefined);

            await expect(slow).resolves.toHaveProperty('id', 'u1');
            expect(exchanges).toStrictEqual([
                'GET /users/slow Bearer access',
                'GET /users/self Bearer access',
                'POST /auth/refresh Bearer access',
                'GET /users/self Bearer fresh',
                'GET /users/slow Bearer fresh',
            ]);
        });

        it('surfaces the 401 and clears the session when the refresh is refused, without refreshing again', async () => {
            const { target, http } = await wired();

            refreshResponse = () => new Response('refused', { status: 401 });

            await expect(http.get('users/self')).rejects.toHaveProperty('status', 401);
            expect(exchanges).toStrictEqual(['GET /users/self Bearer access', 'POST /auth/refresh Bearer access']);
            expect(target.store().isAuthenticated).toBe(false);
        });

        it('signs out without refreshing when the logout itself is refused', async () => {
            const { target } = await wired();

            await target.store().logout();

            expect(exchanges).toStrictEqual(['POST /auth/logout Bearer access']);
            expect(target.store().isAuthenticated).toBe(false);
        });
    });

    describe('device fingerprint', () => {
        it('generates a uuid once and persists it in the application storage', () => {
            const generateUuid = vi.fn(() => 'generated-uuid');
            const target = harness({ generateUuid });

            expect(sessionContext().device()).toStrictEqual({ uuid: 'generated-uuid', os: 'WEB' });
            expect(sessionContext().device()).toStrictEqual({ uuid: 'generated-uuid', os: 'WEB' });
            expect(generateUuid).toHaveBeenCalledTimes(1);
            expect(target.appStorage.get('auth.device_uuid')).toBe('generated-uuid');
        });

        it('reuses a stored uuid under an overridden key and reports a custom os', () => {
            const target = harness({ deviceOs: 'DESKTOP', storageKeys: { deviceUuid: 'app.device' } });

            target.appStorage.set('app.device', 'stored-uuid');

            expect(sessionContext().device()).toStrictEqual({ uuid: 'stored-uuid', os: 'DESKTOP' });
        });

        it('defaults the uuid to a random one', () => {
            harness();

            expect(sessionContext().device().uuid).toMatch(
                /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
            );
        });
    });

    describe('gateway typing', () => {
        /** A user shape richer than the default. */
        interface TenantUser extends SessionUser {
            /** The tenant the user belongs to. */
            readonly tenant: string;
        }

        /** A user shape the tenant gateway does not produce. */
        interface RegionalUser extends TenantUser {
            /** The region the user belongs to. */
            readonly region: string;
        }

        /** A credential shape other than the default. */
        interface TokenCredentials {
            /** The sign-in token. */
            readonly token: string;
        }

        /** A gateway over the richer user and credential shapes. */
        const tenantApi = (): SessionApi<TenantUser, TokenCredentials> => ({
            login: () => Promise.reject(new Error('unused')),
            refresh: () => Promise.reject(new Error('unused')),
            logout: () => Promise.resolve(),
            currentUser: () => Promise.resolve({ ...user(), tenant: 't1' }),
        });

        it('defaults the gateway over the default user shape, for any credentials', () => {
            expect(createSessionModule().name).toBe('session');
            expect(createSessionModule({ storeId: 'auth' }).name).toBe('session');
            expect(createSessionModule<SessionUser, TokenCredentials>().name).toBe('session');
        });

        it('infers the custom user from the gateway for the identity mapping', () => {
            const module = createSessionModule({
                api: tenantApi,
                identity: {
                    analytics: tenantUser => {
                        expectTypeOf(tenantUser).toEqualTypeOf<TenantUser>();

                        return tenantUser.tenant;
                    },
                },
            });

            expect(module.name).toBe('session');
        });

        it('rejects an identity mapping the gateway user does not satisfy', () => {
            /**
             * Map a user carrying a region onto that region.
             */
            const region = (regionalUser: RegionalUser): string => regionalUser.region;

            // @ts-expect-error the mapping needs a field the gateway user lacks
            expect(createSessionModule({ api: tenantApi, identity: { analytics: region } }).name).toBe('session');
        });

        it('requires a gateway for a custom user shape', () => {
            expect(createSessionModule<TenantUser, TokenCredentials>({ api: tenantApi }).name).toBe('session');

            // @ts-expect-error a custom user requires its gateway
            expect(createSessionModule<TenantUser>().name).toBe('session');

            // @ts-expect-error a custom user requires its gateway
            expect(createSessionModule<TenantUser>({ storeId: 'auth' }).name).toBe('session');

            const identity = { analytics: (tenantUser: TenantUser): string => tenantUser.tenant };

            // @ts-expect-error a custom user requires its gateway
            expect(createSessionModule({ identity }).name).toBe('session');
        });
    });
});
