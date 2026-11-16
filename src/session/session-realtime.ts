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

import { ExponentialBackoff } from '@sinemacula/foundation/realtime/exponential-backoff';
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
 * What a connection attempt should do: connect, skip for now while the session
 * may still be renewed, or stop.
 */
type Verdict = 'connect' | 'skip' | 'stop';

const RETRY_BACKOFF = new ExponentialBackoff();

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

        const verdict = await verdictFor(useSessionStore());

        if (verdict === 'stop') {
            connection().disconnect();
        }

        return verdict === 'connect';
    };
}

/**
 * Connect the connection while the store holds a session and disconnect it when
 * the session ends, starting from the store's current state. Connecting applies
 * the reconnect guard's policy and only the latest transition acts. A session
 * replaced by another is reconnected on the new one; a skipped connect is
 * retried with backoff, and at once when a rotation renews the session.
 *
 * @param connection - the realtime connection to drive
 * @param store - the hydrated session store
 * @returns a teardown abandoning pending work and disconnecting a connection
 * this follower opened
 */
export function followSession(connection: RealtimeConnection, store: SessionStore): ModuleTeardown {
    const follower = new SessionFollower(connection, store);

    if (store.isAuthenticated) {
        void follower.reconcile();
    }

    const unwatch = watch([() => store.accessToken, () => store.sessionIdentity()], ([, identity], [, previous]) => {
        follower.follow(identity, previous);
    });

    return () => {
        unwatch();
        follower.dispose();
    };
}

/**
 * Keeps one realtime connection in line with the session store.
 */
class SessionFollower {
    /** The connection driven. */
    readonly #connection: RealtimeConnection;

    /** The hydrated session store followed. */
    readonly #store: SessionStore;

    /** Bumped by every reconciliation and the disposal; only the latest acts. */
    #generation = 0;

    /** The pending retry of a skipped connect, or undefined when none. */
    #retry: ReturnType<typeof setTimeout> | undefined;

    /** How many retries of a skipped connect have been scheduled in a row. */
    #attempt = 0;

    /** Whether the latest reconciliation skipped its connect. */
    #skipped = false;

    /** Whether this follower opened the connection and still holds it. */
    #owned = false;

    /**
     * Follow the store with the connection.
     *
     * @param connection - the realtime connection to drive
     * @param store - the hydrated session store
     */
    constructor(connection: RealtimeConnection, store: SessionStore) {
        this.#connection = connection;
        this.#store = store;
    }

    /**
     * React to a change of the access token or the session identity. A new
     * session starts over, dropping the stream of the one it replaced; a
     * rotation retries a skipped connect at once.
     *
     * @param identity - the session identity now held, or null
     * @param previous - the session identity held before, or null
     */
    follow(identity: object | null, previous: object | null): void {
        if (identity !== previous) {
            if (identity !== null && previous !== null) {
                this.#disconnect();
            }

            void this.reconcile();
        } else if (this.#skipped && !isActive(this.#connection)) {
            void this.reconcile();
        }
    }

    /**
     * Bring the connection in line with the session.
     *
     * @param retrying - whether this retries a skipped connect, continuing its
     * backoff
     */
    async reconcile(retrying = false): Promise<void> {
        this.#generation += 1;
        clearTimeout(this.#retry);
        this.#skipped = false;
        this.#attempt = retrying ? this.#attempt : 0;

        const current = this.#generation;
        const verdict = await verdictFor(this.#store);

        if (current !== this.#generation) {
            return;
        }

        if (verdict === 'stop') {
            this.#disconnect();
        } else if (verdict === 'skip') {
            this.#skip();
        } else {
            this.#open();
        }
    }

    /**
     * Abandon pending work and disconnect the connection this follower opened.
     */
    dispose(): void {
        this.#generation += 1;
        clearTimeout(this.#retry);

        if (this.#owned) {
            this.#disconnect();
        }
    }

    /**
     * Schedule the next retry of a skipped connect.
     */
    #skip(): void {
        this.#skipped = true;
        this.#retry = setTimeout(() => {
            void this.reconcile(true);
        }, RETRY_BACKOFF.delayFor(this.#attempt));
        this.#attempt += 1;
    }

    /**
     * Connect, owning the connection unless it was already active.
     */
    #open(): void {
        const idle = !isActive(this.#connection);

        try {
            this.#connection.connect();
            this.#owned ||= idle;
        } catch (error) {
            reporting().captureError(error);
        }
    }

    /**
     * Disconnect, giving the connection up.
     */
    #disconnect(): void {
        this.#owned = false;
        this.#connection.disconnect();
    }
}

/**
 * Judge what a connection attempt should do for the session, refreshing an
 * expiring session first.
 *
 * @param store - the hydrated session store
 * @returns the verdict
 */
async function verdictFor(store: SessionStore): Promise<Verdict> {
    const standing = standingOf(store);

    if (standing !== 'expiring') {
        return proceed(standing);
    }

    const outcome = await sessionContext().coordinator.refresh();

    if (outcome.kind === 'retryable') {
        return 'skip';
    }

    if (outcome.kind !== 'refreshed' && outcome.kind !== 'superseded') {
        return 'stop';
    }

    const after = standingOf(store);

    // Only a refresh that landed vouches for an expiring session.
    if (after === 'expiring') {
        return outcome.kind === 'refreshed' ? 'connect' : 'skip';
    }

    return proceed(after);
}

/**
 * Connect for a current session; stop for a signed-out one.
 *
 * @param standing - where the session stands, other than expiring
 * @returns the verdict
 */
function proceed(standing: Exclude<Standing, 'expiring'>): Verdict {
    return standing === 'signedOut' ? 'stop' : 'connect';
}

/**
 * Whether a connection is connecting or open.
 *
 * @param connection - the realtime connection
 * @returns whether it is active
 */
function isActive(connection: RealtimeConnection): boolean {
    return connection.state === 'connecting' || connection.state === 'open';
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
