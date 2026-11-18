/**
 * The opt-in session module; login UI, copy and user mapping stay app-side.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Pinia } from 'pinia';
import type { RouteLocationRaw } from 'vue-router';

import { createBearerTokenInterceptor } from '@sinemacula/foundation/http/bearer-token-interceptor';
import type { HttpClient } from '@sinemacula/foundation/http/http-client';
import { createDefaultSessionApi } from '@sinemacula/foundation/session/default-session-api';
import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import { RecordSessionPersistence } from '@sinemacula/foundation/session/record-session-persistence';
import type { PasswordCredentials, SessionApi, SessionDevice } from '@sinemacula/foundation/session/session-api';
import { SessionError } from '@sinemacula/foundation/session/session-error';
import type { SessionLock } from '@sinemacula/foundation/session/session-lock';
import type { RefreshOutcome } from '@sinemacula/foundation/session/session-outcomes';
import type { SessionPersistence } from '@sinemacula/foundation/session/session-persistence';
import type { SessionRoutes as BaseSessionRoutes } from '@sinemacula/foundation/session/session-routes';
import type { SessionStorageKeys } from '@sinemacula/foundation/session/session-storage-keys';
import { DEFAULT_SESSION_STORAGE_KEYS } from '@sinemacula/foundation/session/session-storage-keys';
import type { SessionUser } from '@sinemacula/foundation/session/session-user';
import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { api, logger, reporting } from '../app/services';
import type { ModuleDefinition, ModuleRegisterContext, ResolvedPlatform } from '../module/module';
import { IndexedDbSessionRecordStore } from '../storage/indexed-db-session-record-store';
import { StrictWebStorage } from '../storage/strict-web-storage';
import { WebLocksSessionLock } from '../storage/web-locks-session-lock';
import { announceWrites } from './announced-session-persistence';
import { retireLegacySession } from './legacy-session-migration';
import type { SessionContext } from './session-context';
import { installSessionContext, sessionContext } from './session-context';
import type { CrossTabSync, HydrationReporter, LegacySession } from './session-lifecycle';
import { bootSessionLifecycle } from './session-lifecycle';
import { SessionRefreshCoordinator } from './session-refresh-coordinator';
import { useSessionStore } from './session-store';
import { SessionTokenHistory } from './session-token-history';

export type { SessionStorageKeys } from '@sinemacula/foundation/session/session-storage-keys';

/**
 * Route identity over vue-router locations. Defaults: login
 * `{ name: 'auth.login' }`, loginPath '/login', home '/', forbidden
 * '/forbidden' (a path, as the application's fallback or errors module owns
 * that page).
 */
export type SessionRoutes = BaseSessionRoutes<RouteLocationRaw>;

/**
 * Builds the session API gateway over the application HTTP client.
 */
export type SessionApiFactory<U extends SessionUser, C> = (http: HttpClient) => SessionApi<U, C>;

/**
 * Per-channel identity mappings applied to the reporting, analytics and
 * feature-flag holders whenever the session user changes.
 */
export interface SessionIdentityMapping<U extends SessionUser> {
    /** Maps the user onto the error reporter identity. Default `{ id, email, name }` with null fields omitted. */
    readonly reporting?: (user: U) => {
        /** The reporter identity id. */
        id: string;

        /** The reporter identity email; omitted when null. */
        email?: string;

        /** The reporter identity name; omitted when null. */
        name?: string;
    };

    /** Maps the user onto the analytics identify() id. Default the stringified user id. */
    readonly analytics?: (user: U) => string;

    /** Maps the user onto the feature-flag evaluation context. Default `{ userId }`. */
    readonly featureFlags?: (user: U) => Readonly<Record<string, string>>;
}

/**
 * The settings of {@link createSessionModule} other than the gateway.
 */
export interface SessionModuleSettings<U extends SessionUser> {
    /** Registry name. Default 'session'. */
    readonly name?: string;

    /** The pinia store id the session store registers under. Default 'auth'. */
    readonly storeId?: string;

    /** Overrides for the persisted storage keys. */
    readonly storageKeys?: Partial<SessionStorageKeys>;

    /** Overrides for the route identity. */
    readonly routes?: Partial<SessionRoutes>;

    /** Where the session snapshot persists. Default one IndexedDB record, in a database named after the session key, adopting a snapshot an earlier release left in localStorage under that key; registering throws when Web Locks is unavailable and this is not given, and where the browser blocks localStorage or IndexedDB the session is kept in memory until reload, without cross-tab sync, with one logged warning. */
    readonly persistence?: (platform: ResolvedPlatform) => SessionPersistence;

    /** Serialises the sign-in, refresh and sign-out exchanges of every context sharing the persisted session, so a refresh never presents a token another tab has spent. Default a Web Locks lock beside the default persistence; with another persistence, or where localStorage is blocked, a lock serialising only this tab's exchanges. */
    readonly exchangeLock?: (platform: ResolvedPlatform) => SessionLock;

    /** How long before expiry, in milliseconds, the session counts as expiring and is refreshed before a realtime reconnect; each tab refreshes proactively at a random point in the earlier half of that window. Default 60 seconds. */
    readonly refreshSkewMs?: number;

    /** The operating-system label reported in the device fingerprint. Default 'WEB'. */
    readonly deviceOs?: string;

    /** Device uuid factory. Default `crypto.randomUUID()`. */
    readonly generateUuid?: () => string;

    /** Mirror session changes other tabs persist through this module, announced on a BroadcastChannel named after the session key; registering throws when that API is unavailable and this is not false. Default true. */
    readonly crossTabSync?: boolean;

    /** Refresh the session ahead of its expiry. Default true. */
    readonly proactiveRefresh?: boolean;

    /** Redirect to the login route, carrying the sanitised current path, when an authenticated session is lost. Default true. */
    readonly sessionLossRedirect?: boolean;

    /** Connect the application's realtime connection while a session is held and disconnect it when the session ends. Default true; inert without a realtime connection. */
    readonly realtimeFollowsSession?: boolean;

    /** Identity fan-out to the reporting, analytics and feature-flag holders; per-channel overrides merge over the defaults, and false disables the fan-out entirely. */
    readonly identity?: false | SessionIdentityMapping<U>;
}

/**
 * The gateway option: optional over the default user shape, defaulting to the
 * foundation gateway, and required for a custom user shape.
 */
export type SessionGatewayOption<U extends SessionUser, C> = SessionUser extends U
    ? {
          /** Session API factory over the application HTTP client. Default the foundation gateway on the platform clock. */
          readonly api?: SessionApiFactory<U, C>;
      }
    : {
          /** Session API factory over the application HTTP client, mapping the custom user shape. */
          readonly api: SessionApiFactory<U, C>;
      };

/**
 * Options for {@link createSessionModule}.
 */
export type SessionModuleOptions<
    U extends SessionUser = SessionUser,
    C = PasswordCredentials,
> = SessionModuleSettings<U> & SessionGatewayOption<U, C>;

/**
 * The options every overload accepts, erased to the default user shape.
 */
type AnySessionModuleOptions = SessionModuleSettings<SessionUser> & {
    /** Session API factory over the application HTTP client. */
    readonly api?: SessionApiFactory<SessionUser, unknown>;
};

/**
 * A persistence other tabs share, and the lock their exchanges run under.
 */
interface SharedPersistence {
    /** Where the session snapshot persists. */
    readonly persistence: SessionPersistence;

    /** The lock every sharing context's exchanges run under, or undefined for this tab's own. */
    readonly exchangeLock?: SessionLock;

    /** Where earlier releases persisted the session, or null when there is nothing to retire. */
    readonly legacy: LegacyPersistence | null;
}

/**
 * The session's resolved persistence, exchange lock, legacy retirement and
 * cross-tab sync.
 */
interface ResolvedSessionStorage {
    /** The persistence and exchange lock the session context installs. */
    readonly storage: Pick<SessionContext, 'persistence' | 'exchangeLock'>;

    /** Retire the legacy snapshot once, or null when there is none. */
    readonly retired: (() => Promise<void>) | null;

    /** What cross-tab sync observes, or null when it is off. */
    readonly sync: CrossTabSync | null;
}

/**
 * The site storage the default persistence is built over.
 */
interface SiteStorage {
    /** The window localStorage. */
    readonly area: Storage;

    /** The window IndexedDB. */
    readonly factory: IDBFactory;
}

/**
 * The localStorage persistence earlier releases kept the session in.
 */
interface LegacyPersistence {
    /** The localStorage area holding the legacy snapshot. */
    readonly area: Storage;

    /** The legacy snapshot's persistence, as earlier releases built it. */
    readonly persistence: SessionPersistence;

    /** The lock earlier releases run their exchanges under. */
    readonly lock: SessionLock;
}

const DEFAULT_ROUTES: SessionRoutes = {
    login: { name: 'auth.login' },
    loginPath: '/login',
    home: '/',
    forbidden: '/forbidden',
};

const DEFAULT_REFRESH_SKEW_MS = 60_000;

const SUPERSEDED: RefreshOutcome = { kind: 'superseded' };

/**
 * Create the session module over the application's own gateway, inferring the
 * user and credential shapes from it.
 */
export function createSessionModule<U extends SessionUser, C>(
    options: SessionModuleSettings<U> & {
        /** Session API factory over the application HTTP client. */
        readonly api: SessionApiFactory<U, C>;
    },
): ModuleDefinition;

/**
 * Create the session module. Over the default user shape the gateway defaults
 * to the foundation one; a custom user shape requires the application's own.
 */
export function createSessionModule<U extends SessionUser = SessionUser, C = PasswordCredentials>(
    ...options: SessionUser extends U ? [options?: SessionModuleOptions<U, C>] : [options: SessionModuleOptions<U, C>]
): ModuleDefinition;

export function createSessionModule(options: AnySessionModuleOptions = {}): ModuleDefinition {
    const storageKeys: SessionStorageKeys = { ...DEFAULT_SESSION_STORAGE_KEYS, ...options.storageKeys };
    const routes: SessionRoutes = { ...DEFAULT_ROUTES, ...options.routes };
    const reportHydration = createHydrationReporter();

    let crossTabSync: CrossTabSync | null;

    return {
        name: options.name ?? 'session',
        routes: [],
        register: context => {
            crossTabSync = registerSession(context, options, storageKeys, routes, reportHydration);
        },
        stores: [
            pinia => {
                void sessionContext().ready();

                return useSessionStore(pinia);
            },
        ],
        boot: context =>
            bootSessionLifecycle(context, {
                routes,
                sessionKey: storageKeys.session,
                crossTabSync,
                proactiveRefresh: options.proactiveRefresh ?? true,
                sessionLossRedirect: options.sessionLossRedirect ?? true,
                realtimeFollowsSession: options.realtimeFollowsSession ?? true,
                identity: options.identity ?? {},
                reportHydration,
                random: Math.random,
            }),
    };
}

/**
 * Install the session context, contribute the bearer-token interceptor, and
 * claim the unauthorized handler. Every request and refresh first awaits the
 * session's hydration, which itself sends no request.
 *
 * @returns what cross-tab sync observes, or null when it is disabled or blocked
 * storage left the default persistence in memory, shared with no other tab
 */
function registerSession(
    context: ModuleRegisterContext,
    options: AnySessionModuleOptions,
    storageKeys: SessionStorageKeys,
    routes: SessionRoutes,
    reportHydration: HydrationReporter,
): CrossTabSync | null {
    const { pinia, platform, storage } = context;
    const apiFactory = options.api ?? (http => createDefaultSessionApi<unknown>(http, { now: platform.clock }));
    const generateUuid = options.generateUuid ?? ((): string => crypto.randomUUID());
    const deviceOs = options.deviceOs ?? 'WEB';

    const session = resolveSessionStorage(platform, options, storageKeys.session);
    const ready = createReadiness(pinia, reportHydration, session.retired);
    const coordinator = createRefreshAuthority(pinia, ready);

    let gateway: SessionApi<SessionUser, unknown> | null = null;

    installSessionContext({
        ...session.storage,
        createLineage: () => crypto.randomUUID(),
        routes,
        storeId: options.storeId ?? 'auth',
        coordinator,
        ready,
        clock: platform.clock,
        schedule: platform.schedule,
        refreshSkewMs: options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS,
        device: () => deviceFingerprint(storage, storageKeys.deviceUuid, generateUuid, deviceOs),
        get api(): SessionApi<SessionUser, unknown> {
            gateway ??= apiFactory(api());

            return gateway;
        },
    });

    contributeHttp(context, ready, coordinator);

    return session.sync;
}

/**
 * Resolve where the session persists and the lock its exchanges run under, with
 * the retirement of any legacy snapshot and what cross-tab sync observes.
 */
function resolveSessionStorage(
    platform: ResolvedPlatform,
    options: AnySessionModuleOptions,
    key: string,
): ResolvedSessionStorage {
    const shared =
        options.persistence === undefined
            ? createDefaultPersistence(platform, key)
            : { persistence: options.persistence(platform), legacy: null };
    const channel = shared !== null && (options.crossTabSync ?? true) ? openChannel(platform.targetWindow, key) : null;
    const persistence = sharedPersistence(shared, channel);
    const legacy =
        shared === null || shared.legacy === null ? null : createLegacyRetirement(shared.legacy, persistence);
    const retired = legacy === null ? null : once(legacy.retire);
    const exchangeLock = options.exchangeLock?.(platform) ?? shared?.exchangeLock;

    return {
        storage: {
            persistence,
            ...(exchangeLock === undefined
                ? {}
                : { exchangeLock: retired === null ? exchangeLock : afterRetirement(exchangeLock, retired) }),
        },
        retired,
        sync: channel === null ? null : { channel, legacy },
    };
}

/**
 * Attach the session's bearer token to every request once hydrated, and retry a
 * 401 on the current token, refreshing first unless the request's session token
 * has since been replaced.
 */
function contributeHttp(
    context: ModuleRegisterContext,
    ready: () => Promise<void>,
    coordinator: SessionRefreshCoordinator,
): void {
    const history = new SessionTokenHistory();

    /** Read the held access token. */
    const accessToken = (): string | null => useSessionStore(context.pinia).accessToken;
    const attachBearer = createBearerTokenInterceptor({ getAccessToken: accessToken });

    context.http.addRequestInterceptor(async request => {
        await ready();

        const attached = await attachBearer(request);

        if (attached !== request) {
            history.record(attached);
        }

        return attached;
    });
    context.http.setUnauthorizedHandler(async request => {
        /** Whether the request's session token has since been replaced. */
        const isStale = (): boolean => history.isSuperseded(request, accessToken());

        return isStale() || (await coordinator.refresh()).kind === 'refreshed' || isStale();
    });
}

/**
 * Build the session readiness: retire any legacy session, then hydrate the
 * persisted session once, on first call, reporting a failure instead of
 * rejecting.
 */
function createReadiness(
    pinia: Pinia,
    reportHydration: HydrationReporter,
    retired: (() => Promise<void>) | null,
): () => Promise<void> {
    let hydration: Promise<void> | null = null;

    return () => {
        hydration ??= reportHydration(
            (retired?.() ?? Promise.resolve()).then(() => useSessionStore(pinia).hydrate()),
        ).then(() => undefined);

        return hydration;
    };
}

/**
 * Build the reporter of failed hydrations, resolving whether each succeeded. A
 * failure identical to the one last reported is not reported again until a
 * hydration succeeds.
 */
function createHydrationReporter(): HydrationReporter {
    let reported: string | null = null;

    return hydration =>
        hydration.then(
            () => {
                reported = null;

                return true;
            },
            (error: unknown) => {
                const signature = String(error);

                if (signature !== reported) {
                    reported = signature;
                    reporting().captureError(error);
                }

                return false;
            },
        );
}

/**
 * Build the single refresh authority. Each refresh first awaits readiness, so
 * an empty store is never refreshed, and a failure is reported once however
 * many callers share it. A refresh whose session another one replaced by the
 * time it settles reports `superseded`, so its outcome never ends the renewal
 * of the session that replaced it.
 */
function createRefreshAuthority(pinia: Pinia, ready: () => Promise<void>): SessionRefreshCoordinator {
    return new SessionRefreshCoordinator(async () => {
        await ready();

        const store = useSessionStore(pinia);
        const owner = store.sessionIdentity();
        const outcome = await store.refresh();

        if (outcome.kind === 'failed') {
            reporting().captureError(outcome.error);
        }

        const current = store.sessionIdentity();

        return current !== null && current !== owner ? SUPERSEDED : outcome;
    });
}

/**
 * Persist the session snapshot as one IndexedDB record every tab swaps
 * atomically, with each credential exchange under a Web Locks lock every tab
 * shares, retiring the localStorage snapshot earlier releases wrote under the
 * same key and lock names.
 *
 * @returns the persistence, exchange lock and legacy persistence, or null when
 * the browser blocks localStorage or IndexedDB
 * @throws {@link SessionError} when the Web Locks API is unavailable
 */
function createDefaultPersistence(platform: ResolvedPlatform, key: string): SharedPersistence | null {
    const site = accessSiteStorage(platform.targetWindow);

    if (site === null) {
        return null;
    }

    const locks: LockManager | undefined = platform.targetWindow.navigator.locks;

    if (locks === undefined) {
        throw new SessionError(
            'The session module needs the Web Locks API to share the persisted session across tabs; ' +
                'pass the persistence option where it is unavailable.',
        );
    }

    const exchangeLock = new WebLocksSessionLock(locks, `${key}:exchange`);

    return {
        persistence: new RecordSessionPersistence(new IndexedDbSessionRecordStore(site.factory, key)),
        exchangeLock,
        legacy: {
            area: site.area,
            persistence: new KeyValueSessionPersistence(new StrictWebStorage(site.area), {
                key,
                lock: new WebLocksSessionLock(locks, `${key}:lock`),
            }),
            lock: exchangeLock,
        },
    };
}

/**
 * Resolve the window's localStorage and IndexedDB, whose getters throw where
 * site storage is blocked.
 *
 * @returns both, or null when either is blocked or IndexedDB is missing
 */
function accessSiteStorage(target: Window): SiteStorage | null {
    try {
        const area = target.localStorage;
        const factory: IDBFactory | undefined = target.indexedDB;

        return factory === undefined ? null : { area, factory };
    } catch {
        return null;
    }
}

/**
 * Announce the shared persistence's writes on the channel, if any, or keep the
 * session in memory where storage is blocked.
 */
function sharedPersistence(shared: SharedPersistence | null, channel: BroadcastChannel | null): SessionPersistence {
    if (shared === null) {
        return createTabPersistence();
    }

    return channel === null ? shared.persistence : announceWrites(shared.persistence, channel);
}

/**
 * Bind the retirement of the legacy snapshot into the given persistence,
 * reporting a failure instead of rejecting.
 */
function createLegacyRetirement(legacy: LegacyPersistence, persistence: SessionPersistence): LegacySession {
    return {
        area: legacy.area,
        retire: () =>
            retireLegacySession(legacy.persistence, persistence, legacy.lock).catch((error: unknown) => {
                reporting().captureError(error);
            }),
    };
}

/**
 * Run the task on first call only, sharing its settlement with every later
 * call.
 */
function once(task: () => Promise<void>): () => Promise<void> {
    let run: Promise<void> | null = null;

    return () => {
        run ??= task();

        return run;
    };
}

/**
 * Hold each exchange until the first legacy retirement has settled, as that
 * retirement takes the exchange lock and an exchange awaits readiness.
 */
function afterRetirement(lock: SessionLock, retired: () => Promise<void>): SessionLock {
    return {
        run: async task => {
            await retired();

            return lock.run(task);
        },
    };
}

/**
 * Open the channel every tab announces its session writes on.
 *
 * @throws {@link SessionError} when the BroadcastChannel API is unavailable
 */
function openChannel(target: Window, key: string): BroadcastChannel {
    const Channel: typeof BroadcastChannel | undefined = (target as Window & typeof globalThis).BroadcastChannel;

    if (Channel === undefined) {
        throw new SessionError(
            'Cross-tab session sync needs the BroadcastChannel API; set crossTabSync to false where it is unavailable.',
        );
    }

    return new Channel(key);
}

/**
 * Keep the session snapshot in memory for this page's lifetime, warning once
 * that it ends on reload and is shared with no other tab.
 */
function createTabPersistence(): SessionPersistence {
    logger().warn(
        'Site storage is blocked, so the session is kept in memory: it ends on reload and is not shared with other tabs.',
    );

    return new KeyValueSessionPersistence(new MemoryStorage());
}

/**
 * Return this browser's stable device fingerprint, generating and persisting
 * its uuid on first call.
 */
function deviceFingerprint(
    storage: KeyValueStorage,
    key: string,
    generateUuid: () => string,
    os: string,
): SessionDevice {
    const existing = storage.get(key);

    if (existing !== null) {
        return { uuid: existing, os };
    }

    const uuid = generateUuid();

    storage.set(key, uuid);

    return { uuid, os };
}
