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

    /** The outstanding requests, each with its modules. */
    readonly #requests = new Set<readonly string[]>();

    /** Settles the next time a request is released. */
    #release: Promise<void>;

    /** Settles {@link #release}. */
    #notify: () => void;

    constructor(kept: readonly string[]) {
        this.#kept = new Set(kept);
        [this.#release, this.#notify] = nextRelease();
    }

    /**
     * The modules kept loaded and those still requested.
     */
    required(): string[] {
        return [...new Set([...this.#kept, ...[...this.#requests].flat()])];
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
        const request = [...modules];

        this.#requests.add(request);

        return () => {
            if (!this.#requests.delete(request)) {
                return;
            }

            this.#notify();
            [this.#release, this.#notify] = nextRelease();
        };
    }

    /**
     * Settles the next time a request is released.
     */
    released(): Promise<void> {
        return this.#release;
    }
}

/**
 * A promise for the next release, and the callback that settles it.
 */
function nextRelease(): [Promise<void>, () => void] {
    let notify!: () => void;
    const release = new Promise<void>(resolve => {
        notify = resolve;
    });

    return [release, notify];
}
