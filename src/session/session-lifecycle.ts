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

/** Reports a hydration's failure, resolving whether it succeeded. */
export type HydrationReporter = (hydration: Promise<void>) => Promise<boolean>;

/** What cross-tab sync observes. */
export interface CrossTabSync {
    /** The channel every tab announces its committed session writes on. */
    readonly channel: BroadcastChannel;

    /** The localStorage snapshot earlier releases may still write, or null when there is none to retire. */
    readonly legacy: LegacySession | null;
}

/** The localStorage snapshot earlier releases kept the session in. */
export interface LegacySession {
    /** The localStorage area holding it. */
    readonly area: Storage;

    /** Retire a session found in it; never rejects. */
    readonly retire: () => Promise<void>;
}

/** The resolved boot-phase toggles and inputs. */
export interface SessionLifecycleOptions {
    /** The resolved route identity. */
    readonly routes: SessionRoutes;

    /** The storage key the session snapshot persists under. */
    readonly sessionKey: string;

    /** What to observe to mirror session changes other tabs persist, or null not to. */
    readonly crossTabSync: CrossTabSync | null;

    /** Whether to refresh the session ahead of its expiry. */
    readonly proactiveRefresh: boolean;

    /** Whether to redirect to login when the session is lost. */
    readonly sessionLossRedirect: boolean;

    /** Whether the realtime connection follows the session. */
    readonly realtimeFollowsSession: boolean;

    /** The caller's identity mapping, or false to disable the fan-out. */
    readonly identity: false | SessionIdentityMapping<SessionUser>;

    /** Reports a failed hydration, resolving whether it succeeded. */
    readonly reportHydration: HydrationReporter;

    /** Draws a uniform sample in [0, 1) placing this tab's proactive refresh. */
    readonly random: () => number;
}

/** The identity values last fanned out to each channel. */
interface AppliedIdentity {
    /** The reporter identity. */
    readonly reporting: ReturnType<Required<SessionIdentityMapping<SessionUser>>['reporting']>;

    /** The analytics identity. */
    readonly analytics: string;

    /** The feature-flag evaluation context. */
    readonly featureFlags: Readonly<Record<string, string>>;
}

/** Fans the session identity out to the reporting, analytics and feature-flag holders. */
interface IdentityFanOut {
    /** Fan the given user's identity out. */
    readonly apply: (user: SessionUser) => void;

    /** Clear every channel, if an identity was fanned out. */
    readonly clear: () => void;
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
    const fanOut = options.identity === false ? null : createIdentityFanOut(resolveIdentityMapping(options.identity));
    const teardowns: ModuleTeardown[] = [];

    let disposed = false;

    /**
     * Load the held session's user; until torn down, a session whose user
     * cannot be loaded no longer vouches for the identity fanned out.
     */
    const loadUser = async (): Promise<void> => {
        const identity = store.sessionIdentity();

        await store.rehydrateUser();

        if (!disposed && store.user === null && store.sessionIdentity() === identity) {
            fanOut?.clear();
        }
    };

    if (options.sessionLossRedirect) {
        teardowns.push(wireSessionLossRedirect(context.router, store, options.routes));
    }

    if (options.crossTabSync !== null) {
        teardowns.push(wireCrossTabSync(context.platform.targetWindow, options.crossTabSync, store, options, loadUser));
        await options.crossTabSync.legacy?.retire();
        await options.reportHydration(store.hydrate());
    }

    if (fanOut !== null) {
        teardowns.push(wireIdentityFanOut(store, fanOut));
    }

    if (options.proactiveRefresh) {
        teardowns.push(wireProactiveRefresh(session, store, options.random));
    }

    if (options.realtimeFollowsSession && context.realtime !== null) {
        teardowns.push(followSession(context.realtime, store));
    }

    void loadUser();

    return () => {
        disposed = true;

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
 * Re-hydrate, then load the adopted user, on another tab's announcement, a
 * back-forward cache restore or, once retired, a legacy write.
 */
function wireCrossTabSync(
    target: Window,
    sync: CrossTabSync,
    store: SessionStore,
    options: SessionLifecycleOptions,
    loadUser: () => Promise<void>,
): ModuleTeardown {
    let disposed = false;

    /** Adopt the persisted session, then load its user unless disposed. */
    const synchronise = async (): Promise<void> => {
        if ((await options.reportHydration(store.hydrate())) && !disposed) {
            void loadUser();
        }
    };

    /**
     * Synchronise on another tab's announcement.
     */
    const onMessage = (): void => {
        void synchronise();
    };

    /**
     * Synchronise on a restore from the back-forward cache.
     */
    const onPageShow = (event: PageTransitionEvent): void => {
        if (event.persisted) {
            void synchronise();
        }
    };

    /**
     * Retire a session an earlier release wrote to the legacy key, then
     * synchronise.
     */
    const onStorage = (event: StorageEvent): void => {
        if (event.storageArea === sync.legacy?.area && event.key === options.sessionKey) {
            void sync.legacy.retire().then(synchronise);
        }
    };

    sync.channel.addEventListener('message', onMessage);
    target.addEventListener('pageshow', onPageShow);
    target.addEventListener('storage', onStorage);

    return () => {
        disposed = true;
        sync.channel.close();
        target.removeEventListener('pageshow', onPageShow);
        target.removeEventListener('storage', onStorage);
    };
}

/**
 * Fan the identity of the current user out, then again whenever it changes,
 * clearing it on sign-out. A held session whose user is still loading changes
 * nothing, so another tab's sign-in keeps the identity until its user is
 * known; another tab's rotation keeps the user and changes nothing at all.
 */
function wireIdentityFanOut(store: SessionStore, fanOut: IdentityFanOut): ModuleTeardown {
    if (store.user !== null) {
        fanOut.apply(store.user);
    }

    return watch([() => store.user, () => store.isAuthenticated], ([user, authenticated]) => {
        if (user !== null) {
            fanOut.apply(user);
        } else if (!authenticated) {
            fanOut.clear();
        }
    });
}

/**
 * Keep a single refresh armed ahead of the session expiry, through the refresh
 * authority so it never races a 401 refresh. Each tab fires at its own random
 * point in the earlier half of the skew window, so the first rotation reaches
 * the other tabs before they refresh. A transient failure is left to the 401
 * path and a refusal clears the session, which the loss watcher redirects.
 */
function wireProactiveRefresh(session: SessionContext, store: SessionStore, random: () => number): ModuleTeardown {
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

        const spread = Math.floor((random() * session.refreshSkewMs) / 2);
        const delay = Math.max(0, expiresAtEpochMs - session.clock() - session.refreshSkewMs + spread);

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
 * Build the identity fan-out. A user touches only the channels whose mapped
 * value changed, a different analytics identity resets the previous one first,
 * and clearing clears all three channels together.
 */
function createIdentityFanOut(mapping: Required<SessionIdentityMapping<SessionUser>>): IdentityFanOut {
    let applied: AppliedIdentity | null = null;

    return {
        apply: user => {
            const next: AppliedIdentity = {
                reporting: mapping.reporting(user),
                analytics: mapping.analytics(user),
                featureFlags: mapping.featureFlags(user),
            };

            if (applied !== null && applied.analytics !== next.analytics) {
                analytics().reset();
            }

            if (!hasSameEntries(applied?.reporting, next.reporting)) {
                reporting().setUser(next.reporting);
            }

            if (applied?.analytics !== next.analytics) {
                analytics().identify(next.analytics);
            }

            if (!hasSameEntries(applied?.featureFlags, next.featureFlags)) {
                featureFlags().setContext(next.featureFlags);
            }

            applied = next;
        },
        clear: () => {
            if (applied === null) {
                return;
            }

            applied = null;
            reporting().setUser(null);
            analytics().reset();
            featureFlags().setContext({});
        },
    };
}

/**
 * Whether a flat record, if any, holds exactly the entries of another.
 */
function hasSameEntries(
    left: Readonly<Record<string, unknown>> | undefined,
    right: Readonly<Record<string, unknown>>,
): boolean {
    return (
        left !== undefined &&
        Object.keys(left).length === Object.keys(right).length &&
        Object.entries(right).every(([key, value]) => left[key] === value)
    );
}
