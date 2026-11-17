/**
 * Session module context.
 *
 * The resolved session-module collaborators, installed once at the module's
 * register phase and read lazily by the session store, the guard factories, the
 * authorization helpers and the realtime reconnect guard: the foundation core
 * slice (persistence, the lazily-built API gateway, the device fingerprint)
 * plus the route identity, the store id, the single refresh authority, the
 * hydration readiness, the clock and skew expiry is judged by, and the
 * scheduler that times refreshes and retries.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { PasswordCredentials } from '@sinemacula/foundation/session/session-api';
import type { SessionCoreContext } from '@sinemacula/foundation/session/session-core';
import type { SessionUser } from '@sinemacula/foundation/session/session-user';
import { createServiceHolder } from '@sinemacula/foundation/support/service-holder';
import type { ScheduleTask } from '../module/module';
import type { SessionRoutes } from './create-session-module';
import type { SessionRefreshCoordinator } from './session-refresh-coordinator';

/**
 * The resolved collaborators shared across the session module's units.
 */
export interface SessionContext<U extends SessionUser = SessionUser, C = PasswordCredentials>
    extends SessionCoreContext<U, C> {
    /** The resolved route identity feeding guards and redirects. */
    readonly routes: SessionRoutes;

    /** The pinia store id the session store registers under. */
    readonly storeId: string;

    /** The single refresh authority every refresh path (401 retry, proactive timer, realtime reconnect) routes through, collapsing concurrent attempts into one and announcing those that end renewal. */
    readonly coordinator: SessionRefreshCoordinator;

    /** Settles once the persisted session has been hydrated into the store, starting hydration on first call; never rejects. */
    readonly ready: () => Promise<void>;

    /** Reads the current time as epoch milliseconds. */
    readonly clock: () => number;

    /** Schedules and cancels the proactive refresh and realtime retries. */
    readonly schedule: ScheduleTask;

    /** How long before expiry a session counts as expiring, in milliseconds. */
    readonly refreshSkewMs: number;
}

const holder = createServiceHolder<SessionContext<SessionUser, unknown>>('session context');

/**
 * Install the session context. Called once at the module's register phase.
 *
 * @param context - the resolved context to install
 */
export function installSessionContext<U extends SessionUser, C>(context: SessionContext<U, C>): void {
    holder.install(context as unknown as SessionContext<SessionUser, unknown>);
}

/**
 * The installed session context, cast to the application's user and credential
 * shapes.
 *
 * @returns the installed context
 * @throws Error when accessed before {@link installSessionContext}
 */
export function sessionContext<U extends SessionUser = SessionUser, C = PasswordCredentials>(): SessionContext<U, C> {
    return holder.resolve() as unknown as SessionContext<U, C>;
}

/**
 * Clear the session context back to its uninstalled state. Test-only.
 */
export function resetSessionContext(): void {
    holder.reset();
}
