/**
 * Best-effort Web Storage adapter; storage failures never reach the caller.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';

/**
 * Persist values in a browser `Storage` area.
 */
export class BrowserStorage implements KeyValueStorage {
    /** The underlying Web Storage area. */
    readonly #storage: Storage;

    constructor(storage: Storage) {
        this.#storage = storage;
    }

    /**
     * Read from the underlying Web Storage, returning null when it throws.
     */
    get(key: string): string | null {
        try {
            return this.#storage.getItem(key);
        } catch {
            return null;
        }
    }

    /**
     * Write to the underlying Web Storage; a storage failure is swallowed.
     */
    set(key: string, value: string): void {
        try {
            this.#storage.setItem(key, value);
        } catch {
            // Best-effort: storage may be unavailable or full.
        }
    }

    /**
     * Remove from the underlying Web Storage; a storage failure is swallowed.
     */
    remove(key: string): void {
        try {
            this.#storage.removeItem(key);
        } catch {
            // Best-effort: storage may be unavailable.
        }
    }
}
