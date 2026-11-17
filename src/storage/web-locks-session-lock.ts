/**
 * {@link SessionLock} over Web Locks, serialising session writes across tabs.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { SessionLock } from '@sinemacula/foundation/session/session-lock';

/**
 * Serialise tasks across every context sharing a Web Locks lock name.
 */
export class WebLocksSessionLock implements SessionLock {
    /** The lock manager the lock is requested from. */
    readonly #locks: LockManager;

    /** The lock name every participating context shares. */
    readonly #name: string;

    constructor(locks: LockManager, name: string) {
        this.#locks = locks;
        this.#name = name;
    }

    /**
     * Run the task while holding the exclusive lock. A failed request or task
     * rejects with its error.
     */
    run<T>(task: () => Promise<T>): Promise<T> {
        return this.#locks.request(this.#name, () => task());
    }
}
