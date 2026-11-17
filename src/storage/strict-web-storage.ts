/**
 * Strict key-value storage adapter over the Web Storage API.
 *
 * Unlike {@link BrowserStorage}, every Web Storage failure (private browsing,
 * quota, disabled storage) propagates, so a persistence layer that must never
 * mistake a lost write for a saved one, or an unreadable value for an absent
 * one, can rely on it.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';

/**
 * Persist values in a browser `Storage` area, letting every failure throw.
 */
export class StrictWebStorage implements KeyValueStorage {
    /** The underlying Web Storage area. */
    readonly #storage: Storage;

    constructor(storage: Storage) {
        this.#storage = storage;
    }

    /**
     * Read from the underlying Web Storage.
     */
    get(key: string): string | null {
        return this.#storage.getItem(key);
    }

    /**
     * Write to the underlying Web Storage.
     */
    set(key: string, value: string): void {
        this.#storage.setItem(key, value);
    }

    /**
     * Remove from the underlying Web Storage.
     */
    remove(key: string): void {
        this.#storage.removeItem(key);
    }
}
