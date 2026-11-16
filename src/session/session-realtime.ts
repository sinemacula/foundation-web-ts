/**
 * Realtime connection policy over the session.
 *
 * `sessionReconnectGuard` is the reconnect hook a realtime connection is built
 * with: it lets an attempt proceed only for a current session, refreshing an
 * expiring one through the single refresh authority first, and stops the
 * connection for good when the session is gone or cannot be refreshed. The
 * session module uses the same policy to connect the installed realtime
 * connection while a session is held, since a connection never runs the
 * reconnect hook before its first or a manual connect.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { watch } from 'vue';

import type { RealtimeConnection } from '@sinemacula/foundation/realtime/realtime-connection';
import type { BeforeReconnectHook } from '@sinemacula/foundation/realtime/reconnect';
import { realtime, reporting } from '../app/services';
import type { ModuleTeardown } from '../module/module';
import { sessionContext } from './session-context';
import type { SessionStore } from './session-store';
import { useSessionStore } from './session-store';

/**
 * Where the session stands for a connection: signed out, current, or expiring
 * within the refresh skew.
 */
type Standing = 'signedOut' | 'current' | 'expiring';

/**
 * Build the reconnect hook keeping a realtime connection on the session.
 *
 * Each attempt awaits the session's hydration. Signed out, the connection is
 * disconnected. An access token expiring within the refresh skew on the
 * platform clock is refreshed first: a transient failure skips the attempt for
 * backoff to retry; a refusal, a return to pending authentication or a failure
 * disconnects; a refresh another session transition overtook re-evaluates the
 * session as it now stands, without refreshing again. An unknown expiry counts
 * as current.
 *
 * @param connection - resolves the connection the hook guards, to disconnect
 * it; default the application's installed realtime connection
 * @returns the reconnect hook
 */
export function sessionReconnectGuard(connection: () => RealtimeConnection = realtime): BeforeReconnectHook {
    return async () => {
        await sessionContext().ready();

        return mayConnect(useSessionStore(), () => {
            connection().disconnect();
        });
    };
}

/**
 * Connect the connection while the store holds a session and disconnect it when
 * the session ends, starting from the store's current state. Connecting applies
 * the reconnect guard's policy; only the latest transition acts.
 *
 * @param connection - the realtime connection to drive
 * @param store - the hydrated session store
 * @returns a teardown stopping the watcher and abandoning pending connects
 */
export function followSession(connection: RealtimeConnection, store: SessionStore): ModuleTeardown {
    let generation = 0;

    /**
     * Bring the connection in line with the session.
     *
     * @param authenticated - whether the store holds a session
     */
    const reconcile = async (authenticated: boolean): Promise<void> => {
        generation += 1;

        const current = generation;

        /** Disconnect, unless a later transition has taken over. */
        const stop = (): void => {
            if (current === generation) {
                connection.disconnect();
            }
        };

        if (!authenticated) {
            stop();

            return;
        }

        if ((await mayConnect(store, stop)) && current === generation) {
            try {
                connection.connect();
            } catch (error) {
                reporting().captureError(error);
            }
        }
    };

    if (store.isAuthenticated) {
        void reconcile(true);
    }

    const unwatch = watch(
        () => store.isAuthenticated,
        authenticated => {
            void reconcile(authenticated);
        },
    );

    return () => {
        generation += 1;
        unwatch();
    };
}

/**
 * Decide whether a connection may open for the session, refreshing an expiring
 * session first and stopping the connection when the session is gone.
 *
 * @param store - the hydrated session store
 * @param stop - disconnects the connection
 * @returns whether the connection may open
 */
async function mayConnect(store: SessionStore, stop: () => void): Promise<boolean> {
    const standing = standingOf(store);

    if (standing !== 'expiring') {
        return mayProceed(standing, stop);
    }

    const outcome = await sessionContext().coordinator.refresh();

    if (outcome.kind === 'retryable') {
        return false;
    }

    if (outcome.kind !== 'refreshed' && outcome.kind !== 'superseded') {
        stop();

        return false;
    }

    const after = standingOf(store);

    // Only a refresh that landed vouches for an expiring session.
    return after === 'expiring' ? outcome.kind === 'refreshed' : mayProceed(after, stop);
}

/**
 * Proceed for a current session; stop for a signed-out one.
 *
 * @param standing - where the session stands, other than expiring
 * @param stop - disconnects the connection
 * @returns whether the connection may open
 */
function mayProceed(standing: Exclude<Standing, 'expiring'>, stop: () => void): boolean {
    if (standing === 'signedOut') {
        stop();

        return false;
    }

    return true;
}

/**
 * Judge where the session stands on the platform clock.
 *
 * @param store - the session store
 * @returns signed out, current, or expiring within the refresh skew
 */
function standingOf(store: SessionStore): Standing {
    if (!store.isAuthenticated) {
        return 'signedOut';
    }

    const { clock, refreshSkewMs } = sessionContext();
    const expiresAt = store.expiresAtEpochMs;

    return expiresAt !== null && expiresAt - clock() <= refreshSkewMs ? 'expiring' : 'current';
}
