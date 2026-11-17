/**
 * Reverse-order teardown that keeps going when a step fails.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

/**
 * Collects teardowns and runs them newest first.
 */
export class TeardownStack {
    /** The pending teardowns, oldest first. */
    readonly #teardowns: Array<() => void> = [];

    /**
     * Register a teardown to run before every earlier one.
     */
    push(teardown: () => void): void {
        this.#teardowns.push(teardown);
    }

    /**
     * Run and forget every teardown, newest first, continuing past failures.
     *
     * @returns the failures, in the order they were thrown
     */
    drain(): unknown[] {
        const failures: unknown[] = [];

        for (let teardown = this.#teardowns.pop(); teardown !== undefined; teardown = this.#teardowns.pop()) {
            try {
                teardown();
            } catch (error) {
                failures.push(error);
            }
        }

        return failures;
    }

    /**
     * Drain the stack, then rethrow the failure.
     *
     * @throws the single failure unchanged, or an AggregateError of every
     * failure when several teardowns threw
     */
    dispose(): void {
        const failures = this.drain();

        if (failures.length > 1) {
            throw new AggregateError(failures, `${failures.length} teardowns failed.`);
        }

        if (failures.length === 1) {
            throw failures[0];
        }
    }
}
