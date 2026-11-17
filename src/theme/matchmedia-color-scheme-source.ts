/**
 * OS colour-scheme preference read from `matchMedia`.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { SystemColorSchemeSource } from '@sinemacula/foundation/theme/color-scheme-service';

/**
 * A {@link SystemColorSchemeSource} backed by `matchMedia`.
 */
export class MatchMediaColorSchemeSource implements SystemColorSchemeSource {
    /** The OS dark-scheme media query. */
    readonly #query: MediaQueryList;

    constructor(targetWindow: Window = globalThis.window) {
        this.#query = targetWindow.matchMedia('(prefers-color-scheme: dark)');
    }

    /**
     * Whether the OS currently prefers a dark scheme.
     */
    prefersDark(): boolean {
        return this.#query.matches;
    }

    /**
     * Subscribe to OS-scheme changes.
     *
     * @returns an unsubscribe function
     */
    subscribe(cb: () => void): () => void {
        this.#query.addEventListener('change', cb);

        return () => {
            this.#query.removeEventListener('change', cb);
        };
    }
}
