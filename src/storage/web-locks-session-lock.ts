/**
 * Web Locks session lock.
 *
 * Implements the foundation {@link SessionLock} port over the Web Locks API, so
 * every tab of an origin requesting the same lock name runs its conditional
 * session writes one at a time.
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
