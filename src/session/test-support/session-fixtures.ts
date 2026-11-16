/**
 * Session test fixtures.
 *
 * Scriptable stand-ins shared by the session unit tests: a gateway whose every
 * method is a mock, an in-memory Web Storage area, a serialising lock manager,
 * a recording realtime connection, deferred promises, and a session context
 * over in-memory persistence.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Mock } from 'vitest';
import { vi } from 'vitest';

import { TokenRefreshCoordinator } from '@sinemacula/foundation/http/token-refresh-coordinator';
import type { RealtimeConnection, RealtimeState } from '@sinemacula/foundation/realtime/realtime-connection';
import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import type { SessionApi } from '@sinemacula/foundation/session/session-api';
import type { SessionTokens } from '@sinemacula/foundation/session/session-tokens';
import type { SessionUser } from '@sinemacula/foundation/session/session-user';
import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import type { SessionContext } from '../session-context';
import { useSessionStore } from '../session-store';

/** The default key the session snapshot persists under. */
export const SESSION_KEY = 'auth.session';

/** A gateway whose every method is a mock. */
export type FakeSessionApi = {
    readonly [K in keyof SessionApi]: Mock<SessionApi[K]>;
};

/** A promise settled from outside. */
export interface Deferred<T> {
    /** The promise. */
    readonly promise: Promise<T>;

    /** Fulfil the promise. */
    readonly resolve: (value: T) => void;

    /** Reject the promise. */
    readonly reject: (error: unknown) => void;
}

/** A lock manager recording each requested lock name. */
export interface RecordingLockManager extends LockManager {
    /** Every requested lock name, in order. */
    readonly names: string[];
}

/** A realtime connection recording every connect and disconnect. */
export interface RecordingConnection extends RealtimeConnection {
    /** Every connect and disconnect, in order. */
    readonly calls: string[];

    /** Open after a connect, closed after a disconnect; writable to stage one. */
    state: RealtimeState;
}

/**
 * Build a gateway that rejects every call until scripted.
 *
 * @returns the gateway
 */
export function createFakeSessionApi(): FakeSessionApi {
    /** Reject a call no test scripted. */
    const unscripted = (): Promise<never> => Promise.reject(new Error('Unscripted gateway call.'));

    return {
        login: vi.fn<SessionApi['login']>(unscripted),
        refresh: vi.fn<SessionApi['refresh']>(unscripted),
        logout: vi.fn<SessionApi['logout']>(() => Promise.resolve()),
        currentUser: vi.fn<SessionApi['currentUser']>(unscripted),
    };
}

/**
 * Build a token set.
 *
 * @param overrides - fields to override
 * @returns the tokens
 */
export function tokens(overrides: Partial<SessionTokens> = {}): SessionTokens {
    return { accessToken: 'access', refreshToken: 'refresh', expiresAtEpochMs: null, ...overrides };
}

/**
 * Build a session user.
 *
 * @param overrides - fields to override
 * @returns the user
 */
export function user(overrides: Partial<SessionUser> = {}): SessionUser {
    return { id: 'u1', email: 'alice@example.com', name: 'Alice Smith', permissions: [], ...overrides };
}

/**
 * Write a session snapshot the way the persistence adapter does.
 *
 * @param storage - the key-value storage or Web Storage area to write to
 * @param snapshotTokens - the tokens, or null for a cleared snapshot
 * @param revision - the snapshot revision
 */
export function persistSnapshot(
    storage: KeyValueStorage | Storage,
    snapshotTokens: SessionTokens | null,
    revision = 1,
): void {
    const value = JSON.stringify({ revision, tokens: snapshotTokens });

    if ('setItem' in storage) {
        storage.setItem(SESSION_KEY, value);
    } else {
        storage.set(SESSION_KEY, value);
    }
}

/**
 * Build a promise settled from outside.
 *
 * @returns the deferred
 */
export function deferred<T>(): Deferred<T> {
    const settlers: Partial<Omit<Deferred<T>, 'promise'>> = {};
    const promise = new Promise<T>((resolve, reject) => {
        Object.assign(settlers, { resolve, reject });
    });

    return { promise, ...(settlers as Omit<Deferred<T>, 'promise'>) };
}

/**
 * Build an in-memory Web Storage area.
 *
 * @returns the storage area
 */
export function createWebStorage(): Storage {
    const entries = new Map<string, string>();

    return {
        get length(): number {
            return entries.size;
        },
        key: (index: number): string | null => [...entries.keys()][index] ?? null,
        getItem: (key: string): string | null => entries.get(key) ?? null,
        setItem: (key: string, value: string): void => {
            entries.set(key, value);
        },
        removeItem: (key: string): void => {
            entries.delete(key);
        },
        clear: (): void => {
            entries.clear();
        },
    };
}

/**
 * Build a lock manager granting each name's requests one at a time.
 *
 * @returns the lock manager, recording each requested name
 */
export function createLockManager(): RecordingLockManager {
    const tails = new Map<string, Promise<unknown>>();
    const names: string[] = [];

    return {
        names,
        query: () => Promise.resolve({}),
        request: ((name: string, callback: LockGrantedCallback<unknown>) => {
            names.push(name);

            const result = (tails.get(name) ?? Promise.resolve()).then(() => callback({ mode: 'exclusive', name }));

            tails.set(
                name,
                result.catch(() => undefined),
            );

            return result;
        }) as LockManager['request'],
    };
}

/**
 * Build a realtime connection recording every connect and disconnect.
 *
 * @returns the connection
 */
export function createRecordingConnection(): RecordingConnection {
    const calls: string[] = [];
    const connection: RecordingConnection = {
        calls,
        state: 'idle',
        connect: () => {
            calls.push('connect');
            connection.state = 'open';
        },
        disconnect: () => {
            calls.push('disconnect');
            connection.state = 'closed';
        },
        on: () => () => undefined,
        onStateChange: () => () => undefined,
    };

    return connection;
}

/**
 * Build a session context over in-memory persistence, hydrating the active
 * store on first readiness and refreshing through it.
 *
 * @param overrides - collaborators to override
 * @returns the context
 */
export function createTestSessionContext(overrides: Partial<SessionContext> = {}): SessionContext {
    let hydration: Promise<void> | null = null;

    return {
        persistence: new KeyValueSessionPersistence(new MemoryStorage()),
        api: createFakeSessionApi(),
        device: () => ({ uuid: 'device-uuid', os: 'WEB' }),
        routes: { login: { name: 'auth.login' }, loginPath: '/login', home: '/', forbidden: '/forbidden' },
        storeId: 'auth',
        coordinator: new TokenRefreshCoordinator({ refresh: () => useSessionStore().refresh() }),
        ready: () => {
            hydration ??= useSessionStore().hydrate();

            return hydration;
        },
        clock: () => 0,
        refreshSkewMs: 60_000,
        ...overrides,
    };
}
