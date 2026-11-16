/**
 * Session module factory.
 *
 * Builds the opt-in session module: a plain registry entry that installs the
 * session context, contributes the bearer-token interceptor and the single
 * unauthorized (token-refresh) handler at the register phase, starts hydrating
 * the persisted session at the stores phase, and wires the session lifecycle at
 * the boot phase. Login UI, locale copy and the user field mapping stay
 * app-side.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Pinia } from 'pinia';
import type { RouteLocationRaw } from 'vue-router';

import { createBearerTokenInterceptor } from '@sinemacula/foundation/http/bearer-token-interceptor';
import type { HttpClient } from '@sinemacula/foundation/http/http-client';
import { TokenRefreshCoordinator } from '@sinemacula/foundation/http/token-refresh-coordinator';
import { createDefaultSessionApi } from '@sinemacula/foundation/session/default-session-api';
import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import type { PasswordCredentials, SessionApi, SessionDevice } from '@sinemacula/foundation/session/session-api';
import { SessionError } from '@sinemacula/foundation/session/session-error';
import type { RefreshOutcome } from '@sinemacula/foundation/session/session-outcomes';
import type { SessionPersistence } from '@sinemacula/foundation/session/session-persistence';
import type { SessionRoutes as BaseSessionRoutes } from '@sinemacula/foundation/session/session-routes';
import type { SessionStorageKeys } from '@sinemacula/foundation/session/session-storage-keys';
import { DEFAULT_SESSION_STORAGE_KEYS } from '@sinemacula/foundation/session/session-storage-keys';
import type { SessionUser } from '@sinemacula/foundation/session/session-user';
import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';
import { api, reporting } from '../app/services';
import type { ModuleDefinition, ModuleRegisterContext, ResolvedPlatform } from '../module/module';
import { StrictWebStorage } from '../storage/strict-web-storage';
import { WebLocksSessionLock } from '../storage/web-locks-session-lock';
import { installSessionContext, sessionContext } from './session-context';
import { bootSessionLifecycle } from './session-lifecycle';
import { useSessionStore } from './session-store';

export type { SessionStorageKeys } from '@sinemacula/foundation/session/session-storage-keys';

/**
 * Route identity over vue-router locations. Defaults: login
 * `{ name: 'auth.login' }`, loginPath '/login', home '/', forbidden
 * '/forbidden' - the forbidden default is a path string by design: the
 * application's fallback or errors module owns the page.
 */
export type SessionRoutes = BaseSessionRoutes<RouteLocationRaw>;

/**
 * Builds the session API gateway over the application HTTP client.
 */
export type SessionApiFactory<U extends SessionUser, C> = (http: HttpClient) => SessionApi<U, C>;

/**
 * Per-channel identity mappings fanned out to the reporting, analytics and
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
 * The settings of {@link createSessionModule} other than the gateway; every
 * default mirrors the organisation's reference application.
 */
export interface SessionModuleSettings<U extends SessionUser> {
    /** Registry name (the module has no routes and no locales). Default 'session'. */
    readonly name?: string;

    /** The pinia store id the session store registers under. Default 'auth'. */
    readonly storeId?: string;

    /** Overrides for the persisted storage keys. */
    readonly storageKeys?: Partial<SessionStorageKeys>;

    /** Overrides for the route identity. */
    readonly routes?: Partial<SessionRoutes>;

    /** Where the session snapshot persists. Default the target window's localStorage under the session key, serialised across tabs by a Web Locks lock; registering throws when Web Locks is unavailable and this is not given. Cross-tab sync observes that localStorage key, so a persistence elsewhere disables `crossTabSync` and calls the store's `hydrate()` on its own change notifications. */
    readonly persistence?: (platform: ResolvedPlatform) => SessionPersistence;

    /** How long before expiry the session counts as expiring, refreshed proactively and before a realtime reconnect, in milliseconds. Default 60 seconds. */
    readonly refreshSkewMs?: number;

    /** The operating-system label reported in the device fingerprint. Default 'WEB'. */
    readonly deviceOs?: string;

    /** Device uuid factory. Default `crypto.randomUUID()`. */
    readonly generateUuid?: () => string;

    /** Mirror session changes other tabs persist. Default true. */
    readonly crossTabSync?: boolean;

    /** Refresh the session ahead of its expiry. Default true. */
    readonly proactiveRefresh?: boolean;

    /** Redirect to the login route when the session transitions from authenticated to unauthenticated, carrying the sanitised current path as the redirect query parameter. Default true. */
    readonly sessionLossRedirect?: boolean;

    /** Connect the application's realtime connection while a session is held and disconnect it when the session ends. Default true; inert without a realtime connection. */
    readonly realtimeFollowsSession?: boolean;

    /** Identity fan-out to the reporting, analytics and feature-flag holders; per-channel overrides merge over the defaults, and false disables the fan-out entirely. */
    readonly identity?: false | SessionIdentityMapping<U>;
}

/**
 * The gateway option: optional over the default user shape, where it defaults
 * to the foundation gateway, and required for a custom user shape, which only
 * the application's gateway can map.
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

const DEFAULT_ROUTES: SessionRoutes = {
    login: { name: 'auth.login' },
    loginPath: '/login',
    home: '/',
    forbidden: '/forbidden',
};

const DEFAULT_MODULE_NAME = 'session';
const DEFAULT_STORE_ID = 'auth';
const DEFAULT_DEVICE_OS = 'WEB';
const DEFAULT_REFRESH_SKEW_MS = 60_000;

/**
 * Create the session module over the application's own gateway, inferring the
 * user and credential shapes from it.
 *
 * @param options - the gateway and overrides for the reference defaults
 * @returns the module definition for the application registry
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
 *
 * @param options - overrides for the reference-application defaults
 * @returns the module definition for the application registry
 */
export function createSessionModule<U extends SessionUser = SessionUser, C = PasswordCredentials>(
    ...options: SessionUser extends U ? [options?: SessionModuleOptions<U, C>] : [options: SessionModuleOptions<U, C>]
): ModuleDefinition;

export function createSessionModule(options: AnySessionModuleOptions = {}): ModuleDefinition {
    const storageKeys: SessionStorageKeys = { ...DEFAULT_SESSION_STORAGE_KEYS, ...options.storageKeys };
    const routes: SessionRoutes = { ...DEFAULT_ROUTES, ...options.routes };

    return {
        name: options.name ?? DEFAULT_MODULE_NAME,
        routes: [],
        register: context => {
            registerSession(context, options, storageKeys, routes);
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
                crossTabSync: options.crossTabSync ?? true,
                proactiveRefresh: options.proactiveRefresh ?? true,
                sessionLossRedirect: options.sessionLossRedirect ?? true,
                realtimeFollowsSession: options.realtimeFollowsSession ?? true,
                identity: options.identity ?? {},
            }),
    };
}

/**
 * Install the session context, contribute the bearer-token interceptor, and
 * claim the single unauthorized-handler slot. Every request, and every refresh,
 * first awaits the session's hydration, which itself sends no request.
 *
 * @param context - the module register context
 * @param options - the module options
 * @param storageKeys - the resolved storage keys
 * @param routes - the resolved route identity
 */
function registerSession(
    context: ModuleRegisterContext,
    options: AnySessionModuleOptions,
    storageKeys: SessionStorageKeys,
    routes: SessionRoutes,
): void {
    const { pinia, platform, storage } = context;
    const apiFactory = options.api ?? (http => createDefaultSessionApi<unknown>(http, { now: platform.clock }));
    const generateUuid = options.generateUuid ?? ((): string => crypto.randomUUID());
    const deviceOs = options.deviceOs ?? DEFAULT_DEVICE_OS;

    const ready = createReadiness(pinia);
    const coordinator = createRefreshAuthority(pinia, ready);

    let gateway: SessionApi<SessionUser, unknown> | null = null;

    installSessionContext({
        persistence: options.persistence?.(platform) ?? createDefaultPersistence(platform, storageKeys.session),
        routes,
        storeId: options.storeId ?? DEFAULT_STORE_ID,
        coordinator,
        ready,
        clock: platform.clock,
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

        return attachBearer(request);
    });
    context.http.setUnauthorizedHandler(async () => (await coordinator.refresh()).kind === 'refreshed');
}

/**
 * Build the session readiness: hydrate the persisted session once, on first
 * call, reporting a failure and leaving the state as it stands.
 *
 * @param pinia - the application pinia
 * @returns resolves the shared hydration, settled either way
 */
function createReadiness(pinia: Pinia): () => Promise<void> {
    let hydration: Promise<void> | null = null;

    return () => {
        hydration ??= useSessionStore(pinia)
            .hydrate()
            .catch((error: unknown) => {
                reporting().captureError(error);
            });

        return hydration;
    };
}

/**
 * Build the single refresh authority. Each refresh first awaits readiness, so
 * an empty store is never refreshed before the persisted session is in, and a
 * failed refresh is reported once, however many callers share it.
 *
 * @param pinia - the application pinia
 * @param ready - the session readiness
 * @returns the refresh coordinator
 */
function createRefreshAuthority(pinia: Pinia, ready: () => Promise<void>): TokenRefreshCoordinator<RefreshOutcome> {
    return new TokenRefreshCoordinator<RefreshOutcome>({
        refresh: async () => {
            await ready();

            const outcome = await useSessionStore(pinia).refresh();

            if (outcome.kind === 'failed') {
                reporting().captureError(outcome.error);
            }

            return outcome;
        },
    });
}

/**
 * Persist the session snapshot in the target window's localStorage, failing
 * loudly, under a Web Locks lock every tab shares.
 *
 * @param platform - the resolved platform seams
 * @param key - the key the snapshot persists under
 * @returns the session persistence
 * @throws {@link SessionError} when the Web Locks API is unavailable
 */
function createDefaultPersistence(platform: ResolvedPlatform, key: string): SessionPersistence {
    const locks: LockManager | undefined = platform.targetWindow.navigator.locks;

    if (locks === undefined) {
        throw new SessionError(
            'The session module needs the Web Locks API to share the persisted session across tabs; ' +
                'pass the persistence option where it is unavailable.',
        );
    }

    return new KeyValueSessionPersistence(new StrictWebStorage(platform.targetWindow.localStorage), {
        key,
        lock: new WebLocksSessionLock(locks, `${key}:lock`),
    });
}

/**
 * Return the stable device fingerprint for this browser.
 *
 * On first call a uuid is generated and persisted; subsequent calls reuse the
 * stored value so the same device always presents the same fingerprint.
 *
 * @param storage - the key-value store the uuid persists in
 * @param key - the storage key the uuid persists under
 * @param generateUuid - the uuid factory
 * @param os - the operating-system label to report
 * @returns the device fingerprint
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
