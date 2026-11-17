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
import { StrictWebStorage } from '../storage/strict-web-storage';
import { WebLocksSessionLock } from '../storage/web-locks-session-lock';
import { installSessionContext, sessionContext } from './session-context';
import type { HydrationReporter } from './session-lifecycle';
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

    /** Where the session snapshot persists. Default the target window's localStorage under the session key, serialised across tabs by a Web Locks lock; registering throws when Web Locks is unavailable and this is not given, and where the browser blocks localStorage the session is kept in memory until reload, without cross-tab sync, with one logged warning. Cross-tab sync only observes that localStorage key, so with another persistence disable `crossTabSync` and call the store's `hydrate()` on its own change notifications. */
    readonly persistence?: (platform: ResolvedPlatform) => SessionPersistence;

    /** Serialises the sign-in, refresh and sign-out exchanges of every context sharing the persisted session, so a refresh never presents a token another tab has spent. Default a Web Locks lock beside the default persistence; with another persistence, or where localStorage is blocked, a lock serialising only this tab's exchanges. */
    readonly exchangeLock?: (platform: ResolvedPlatform) => SessionLock;

    /** How long before expiry, in milliseconds, the session counts as expiring and is refreshed before a realtime reconnect; each tab refreshes proactively at a random point in the earlier half of that window. Default 60 seconds. */
    readonly refreshSkewMs?: number;

    /** The operating-system label reported in the device fingerprint. Default 'WEB'. */
    readonly deviceOs?: string;

    /** Device uuid factory. Default `crypto.randomUUID()`. */
    readonly generateUuid?: () => string;

    /** Mirror session changes other tabs persist. Default true. */
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

    let shared: boolean;

    return {
        name: options.name ?? 'session',
        routes: [],
        register: context => {
            shared = registerSession(context, options, storageKeys, routes, reportHydration);
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
                crossTabSync: (options.crossTabSync ?? true) && shared,
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
 * session's hydration, which itself sends no request. A 401 for a request sent
 * with a session token since replaced retries on the current token without
 * refreshing again.
 *
 * @returns false when blocked storage left the default persistence in memory,
 * shared with no other tab
 */
function registerSession(
    context: ModuleRegisterContext,
    options: AnySessionModuleOptions,
    storageKeys: SessionStorageKeys,
    routes: SessionRoutes,
    reportHydration: HydrationReporter,
): boolean {
    const { pinia, platform, storage } = context;
    const apiFactory = options.api ?? (http => createDefaultSessionApi<unknown>(http, { now: platform.clock }));
    const generateUuid = options.generateUuid ?? ((): string => crypto.randomUUID());
    const deviceOs = options.deviceOs ?? 'WEB';

    const ready = createReadiness(pinia, reportHydration);
    const coordinator = createRefreshAuthority(pinia, ready);

    const shared =
        options.persistence === undefined
            ? createDefaultPersistence(platform, storageKeys.session)
            : { persistence: options.persistence(platform) };
    const exchangeLock = options.exchangeLock?.(platform) ?? shared?.exchangeLock;
    const history = new SessionTokenHistory();

    let gateway: SessionApi<SessionUser, unknown> | null = null;

    installSessionContext({
        persistence: shared?.persistence ?? createTabPersistence(),
        ...(exchangeLock === undefined ? {} : { exchangeLock }),
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

    const attachBearer = createBearerTokenInterceptor({
        getAccessToken: () => useSessionStore(pinia).accessToken,
    });

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
        const isStale = (): boolean => history.isSuperseded(request, useSessionStore(pinia).accessToken);

        return isStale() || (await coordinator.refresh()).kind === 'refreshed' || isStale();
    });

    return shared !== null;
}

/**
 * Build the session readiness: hydrate the persisted session once, on first
 * call, reporting a failure instead of rejecting.
 */
function createReadiness(pinia: Pinia, reportHydration: HydrationReporter): () => Promise<void> {
    let hydration: Promise<void> | null = null;

    return () => {
        hydration ??= reportHydration(useSessionStore(pinia).hydrate()).then(() => undefined);

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
 * Persist the session snapshot in the target window's localStorage, failing
 * loudly, with each write and each credential exchange under its own Web Locks
 * lock every tab shares.
 *
 * @returns the persistence and exchange lock, or null when the browser blocks
 * localStorage
 * @throws {@link SessionError} when the Web Locks API is unavailable
 */
function createDefaultPersistence(platform: ResolvedPlatform, key: string): SharedPersistence | null {
    let area: Storage;

    try {
        area = platform.targetWindow.localStorage;
    } catch {
        return null;
    }

    const locks: LockManager | undefined = platform.targetWindow.navigator.locks;

    if (locks === undefined) {
        throw new SessionError(
            'The session module needs the Web Locks API to share the persisted session across tabs; ' +
                'pass the persistence option where it is unavailable.',
        );
    }

    return {
        persistence: new KeyValueSessionPersistence(new StrictWebStorage(area), {
            key,
            lock: new WebLocksSessionLock(locks, `${key}:lock`),
        }),
        exchangeLock: new WebLocksSessionLock(locks, `${key}:exchange`),
    };
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
