/**
 * Which modules' messages a locale needs: those kept loaded, and those that
 * navigations still in flight have requested.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

/**
 * Tracks the modules kept loaded through switches and the outstanding requests
 * for others, telling waiters when a request is released.
 */
export class ModuleInterest {
    /** The modules kept loaded through every switch. */
    readonly #kept: Set<string>;

    /** The outstanding requests per module. */
    readonly #requests = new Map<string, number>();

    /** Settles the next time a request is released. */
    #release: Promise<void>;

    /**
     * Settles {@link #release}.
     */
    #notify: () => void = () => undefined;

    constructor(kept: readonly string[]) {
        this.#kept = new Set(kept);
        this.#release = this.#nextRelease();
    }

    /**
     * The modules kept loaded and those still requested.
     */
    required(): string[] {
        return [...new Set([...this.#kept, ...this.#requests.keys()])];
    }

    /**
     * Keep the modules loaded through every later switch.
     */
    keep(modules: readonly string[]): void {
        for (const name of modules) {
            this.#kept.add(name);
        }
    }

    /**
     * Request the modules until the returned release runs; releasing again does
     * nothing.
     */
    request(modules: readonly string[]): () => void {
        for (const name of modules) {
            this.#requests.set(name, (this.#requests.get(name) ?? 0) + 1);
        }

        let released = false;

        return () => {
            if (released) {
                return;
            }

            released = true;

            for (const name of modules) {
                const remaining = (this.#requests.get(name) ?? 1) - 1;

                if (remaining === 0) {
                    this.#requests.delete(name);
                } else {
                    this.#requests.set(name, remaining);
                }
            }

            this.#notify();
            this.#release = this.#nextRelease();
        };
    }

    /**
     * Settles the next time a request is released.
     */
    released(): Promise<void> {
        return this.#release;
    }

    /**
     * A promise the next release settles.
     */
    #nextRelease(): Promise<void> {
        return new Promise(resolve => {
            this.#notify = resolve;
        });
    }
}
