/**
 * The session's single refresh authority.
 *
 * Collapses concurrent refreshes into one and tells its subscribers when a
 * refresh ends the session's renewal - refused, returned to pending
 * authentication, or failed - whichever path started it.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { TokenRefreshCoordinator } from '@sinemacula/foundation/http/token-refresh-coordinator';
import type { RefreshOutcome } from '@sinemacula/foundation/session/session-outcomes';

const TERMINAL: ReadonlySet<RefreshOutcome['kind']> = new Set(['rejected', 'interactionRequired', 'failed']);

/**
 * Deduplicates session refreshes and announces the ones that end renewal.
 */
export class SessionRefreshCoordinator {
    /** The single-flight coordination of the refreshes. */
    readonly #coordinator: TokenRefreshCoordinator<RefreshOutcome>;

    /** Told of every refresh that ends renewal. */
    readonly #listeners = new Set<() => void>();

    /**
     * Coordinate the given refresh.
     *
     * @param refresh - performs one session refresh
     */
    constructor(refresh: () => Promise<RefreshOutcome>) {
        this.#coordinator = new TokenRefreshCoordinator({
            refresh: async () => {
                const outcome = await refresh();

                if (TERMINAL.has(outcome.kind)) {
                    for (const listener of this.#listeners) {
                        listener();
                    }
                }

                return outcome;
            },
        });
    }

    /**
     * Refresh the session, joining any refresh already in flight.
     *
     * @returns the shared outcome
     */
    refresh(): Promise<RefreshOutcome> {
        return this.#coordinator.refresh();
    }

    /**
     * Subscribe to refreshes that end the session's renewal; the subscriber
     * runs before the refresh's callers resume.
     *
     * @param listener - told of each such refresh
     * @returns a function unsubscribing it
     */
    onTerminal(listener: () => void): () => void {
        this.#listeners.add(listener);

        return () => {
            this.#listeners.delete(listener);
        };
    }
}
