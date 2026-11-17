/**
 * Boot-phase wiring of the session module.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { watch } from 'vue';
import type { Router } from 'vue-router';

import { sanitiseRedirectTarget } from '@sinemacula/foundation/session/redirect';
import type { SessionUser } from '@sinemacula/foundation/session/session-user';
import { analytics, featureFlags, reporting } from '../app/services';
import type { ModuleBootContext, ModuleTeardown } from '../module/module';
import type { SessionIdentityMapping, SessionRoutes } from './create-session-module';
import { appendRedirectTarget } from './redirect';
import type { SessionContext } from './session-context';
import { sessionContext } from './session-context';
import { followSession } from './session-realtime';
import type { SessionStore } from './session-store';
import { useSessionStore } from './session-store';

/** The resolved boot-phase toggles and inputs. */
export interface SessionLifecycleOptions {
    /** The resolved route identity. */
    readonly routes: SessionRoutes;

    /** The storage key the session snapshot persists under. */
    readonly sessionKey: string;

    /** Whether to mirror session changes other tabs persist. */
    readonly crossTabSync: boolean;

    /** Whether to refresh the session ahead of its expiry. */
    readonly proactiveRefresh: boolean;

    /** Whether to redirect to login when the session is lost. */
    readonly sessionLossRedirect: boolean;

    /** Whether the realtime connection follows the session. */
    readonly realtimeFollowsSession: boolean;

    /** The caller's identity mapping, or false to disable the fan-out. */
    readonly identity: false | SessionIdentityMapping<SessionUser>;
}

const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;

/**
 * Wire the session lifecycle once the session is hydrated, returning one
 * teardown for every listener, timer and watcher. Watchers precede the user
 * load so a refusal it triggers is still redirected, and a second hydration
 * after the cross-tab listener catches a change persisted before it listened.
 */
export async function bootSessionLifecycle(
    context: ModuleBootContext,
    options: SessionLifecycleOptions,
): Promise<ModuleTeardown> {
    const session = sessionContext();

    await session.ready();

    const store = useSessionStore(context.pinia);
    const teardowns: ModuleTeardown[] = [];

    if (options.sessionLossRedirect) {
        teardowns.push(wireSessionLossRedirect(context.router, store, options.routes));
    }

    if (options.crossTabSync) {
        teardowns.push(wireCrossTabSync(context.platform.targetWindow, store, options.sessionKey));
        await store.hydrate().catch(report);
    }

    if (options.identity !== false) {
        teardowns.push(wireIdentityFanOut(store, resolveIdentityMapping(options.identity)));
    }

    if (options.proactiveRefresh) {
        teardowns.push(wireProactiveRefresh(session, store));
    }

    if (options.realtimeFollowsSession && context.realtime !== null) {
        teardowns.push(followSession(context.realtime, store));
    }

    void store.rehydrateUser();

    return () => {
        for (const teardown of teardowns.reverse()) {
            teardown();
        }
    };
}

/**
 * Redirect to the login route whenever an authenticated session is lost.
 */
function wireSessionLossRedirect(router: Router, store: SessionStore, routes: SessionRoutes): ModuleTeardown {
    return watch(
        () => store.isAuthenticated,
        (authenticated, previously) => {
            if (previously && !authenticated) {
                redirectToLogin(router, routes);
            }
        },
    );
}

/**
 * Re-hydrate whenever another tab changes the session key in the target
 * window's localStorage, or clears it, then load the adopted session's user.
 */
function wireCrossTabSync(target: Window, store: SessionStore, sessionKey: string): ModuleTeardown {
    const area = target.localStorage;

    let disposed = false;

    /** Adopt the persisted session, then load its user unless disposed. */
    const synchronise = async (): Promise<void> => {
        try {
            await store.hydrate();
        } catch (error) {
            report(error);

            return;
        }

        if (!disposed) {
            void store.rehydrateUser();
        }
    };

    /**
     * Synchronise on a change to the session key, or a clear, of the area.
     */
    const onStorage = (event: StorageEvent): void => {
        if (event.storageArea === area && (event.key === sessionKey || event.key === null)) {
            void synchronise();
        }
    };

    target.addEventListener('storage', onStorage);

    return () => {
        disposed = true;
        target.removeEventListener('storage', onStorage);
    };
}

/**
 * Fan the identity of the current user out, then again whenever it changes.
 */
function wireIdentityFanOut(
    store: SessionStore,
    mapping: Required<SessionIdentityMapping<SessionUser>>,
): ModuleTeardown {
    if (store.user !== null) {
        applyIdentity(mapping, store.user);
    }

    return watch(
        () => store.user,
        user => {
            applyIdentity(mapping, user);
        },
    );
}

/**
 * Keep a single refresh armed ahead of the session expiry, through the refresh
 * authority so it never races a 401 refresh. A transient failure is left to the
 * 401 path and a refusal clears the session, which the loss watcher redirects.
 */
function wireProactiveRefresh(session: SessionContext, store: SessionStore): ModuleTeardown {
    /**
     * Cancel the armed refresh, if any.
     */
    let cancel = (): void => undefined;

    /**
     * Arm the refresh ahead of the expiry, replacing any armed one; a null
     * expiry arms none.
     */
    const schedule = (expiresAtEpochMs: number | null): void => {
        cancel();

        if (expiresAtEpochMs === null) {
            return;
        }

        const delay = Math.max(0, expiresAtEpochMs - session.clock() - session.refreshSkewMs);

        cancel =
            delay > MAX_TIMEOUT_DELAY_MS
                ? // Longer delays overflow and fire at once; re-evaluate at the horizon.
                  session.schedule(() => {
                      schedule(expiresAtEpochMs);
                  }, MAX_TIMEOUT_DELAY_MS)
                : session.schedule(() => {
                      void session.coordinator.refresh();
                  }, delay);
    };

    const stop = watch(() => store.expiresAtEpochMs, schedule, { immediate: true });

    return () => {
        stop();
        cancel();
    };
}

/**
 * Push the login route, carrying the current path as the redirect query
 * parameter when it is a safe return target.
 */
function redirectToLogin(router: Router, routes: SessionRoutes): void {
    const target = sanitiseRedirectTarget(router.currentRoute.value.fullPath, routes.loginPath);
    const destination = target === null ? routes.login : appendRedirectTarget(routes.login, target);

    router.push(destination).catch(() => {
        // A rejected navigation must not surface as an unhandled rejection.
    });
}

/**
 * Merge the caller's identity mapping over the per-channel defaults.
 */
function resolveIdentityMapping(
    identity: SessionIdentityMapping<SessionUser>,
): Required<SessionIdentityMapping<SessionUser>> {
    return {
        reporting: identity.reporting ?? defaultReportedIdentity,
        analytics: identity.analytics ?? ((user: SessionUser): string => String(user.id)),
        featureFlags: identity.featureFlags ?? ((user: SessionUser) => ({ userId: String(user.id) })),
    };
}

/**
 * Map a session user onto the default error-reporter identity, omitting a null
 * email or name.
 */
function defaultReportedIdentity(
    user: SessionUser,
): ReturnType<Required<SessionIdentityMapping<SessionUser>>['reporting']> {
    return {
        id: String(user.id),
        ...(user.email === null ? {} : { email: user.email }),
        ...(user.name === null ? {} : { name: user.name }),
    };
}

/**
 * Fan the session identity out to the reporting, analytics and feature-flag
 * holders, clearing all three together on sign-out.
 */
function applyIdentity(mapping: Required<SessionIdentityMapping<SessionUser>>, user: SessionUser | null): void {
    if (user === null) {
        reporting().setUser(null);
        analytics().reset();
        featureFlags().setContext({});

        return;
    }

    reporting().setUser(mapping.reporting(user));
    analytics().identify(mapping.analytics(user));
    featureFlags().setContext(mapping.featureFlags(user));
}

/**
 * Report a session failure the lifecycle contains.
 */
function report(error: unknown): void {
    reporting().captureError(error);
}
