/**
 * The session's single refresh authority.
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
     * Coordinate the given session refresh.
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
     */
    refresh(): Promise<RefreshOutcome> {
        return this.#coordinator.refresh();
    }

    /**
     * Subscribe to refreshes that end the session's renewal (refused, returned
     * to pending authentication, or failed), returning an unsubscribe function.
     * The listener runs before the refresh's callers resume.
     */
    onTerminal(listener: () => void): () => void {
        this.#listeners.add(listener);

        return () => {
            this.#listeners.delete(listener);
        };
    }
}
