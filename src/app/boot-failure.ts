/**
 * Boot-failure reporting: reports a failed boot under a short reference the
 * application can show its users, then reports the rollback's own failures
 * under the same reference.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ErrorReporter } from '@sinemacula/foundation/reporting/error-reporter';

// Crockford base32: no I, L, O or U, so a reference reads unambiguously aloud.
const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const REFERENCE_GROUP_LENGTH = 4;
const REFERENCE_GROUPS = 2;

/**
 * Generate a random reference of the form `XXXX-XXXX`.
 */
export function createBootFailureReference(): string {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(REFERENCE_GROUP_LENGTH * REFERENCE_GROUPS));
    const characters = Array.from(bytes, byte => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length]).join('');

    return Array.from({ length: REFERENCE_GROUPS }, (_, group) =>
        characters.slice(group * REFERENCE_GROUP_LENGTH, (group + 1) * REFERENCE_GROUP_LENGTH),
    ).join('-');
}

/**
 * Reports a failed boot to the reporter wired before the failure, if any.
 */
export class BootFailureReporter {
    /** Generates the reference a boot failure is reported under. */
    readonly #createReference: () => string;

    /** The reporter the boot wired, or null until it is wired. */
    #reporter: ErrorReporter | null = null;

    constructor(createReference: () => string) {
        this.#createReference = createReference;
    }

    /**
     * Record the reporter the boot has wired.
     */
    readonly attach = (reporter: ErrorReporter): void => {
        this.#reporter = reporter;
    };

    /**
     * Report the boot failure, then the rollback failures, never throwing.
     *
     * @returns the reference the boot failure was reported under, or null when
     * it was not reported under one
     */
    report(failure: unknown, rollback: () => readonly unknown[]): string | null {
        const reference = this.#reportFailure(failure);

        for (const rollbackFailure of rollback()) {
            this.#send(rollbackFailure, {
                source: 'boot-rollback',
                ...(reference === null ? {} : { reference }),
            });
        }

        return reference;
    }

    /**
     * Report the boot failure under a fresh reference, or without one when the
     * reference cannot be generated.
     */
    #reportFailure(failure: unknown): string | null {
        if (this.#reporter === null) {
            return null;
        }

        const reference = this.#generateReference();

        const reported = this.#send(failure, {
            source: 'boot',
            ...(reference === null ? {} : { reference }),
        });

        return reported ? reference : null;
    }

    /**
     * Generate a reference, or null when the factory throws.
     */
    #generateReference(): string | null {
        try {
            return this.#createReference();
        } catch {
            return null;
        }
    }

    /**
     * Forward an error to the reporter; a throwing reporter must not mask the
     * boot failure.
     *
     * @returns whether the reporter accepted the error
     */
    #send(error: unknown, context: Readonly<Record<string, unknown>>): boolean {
        if (this.#reporter === null) {
            return false;
        }

        try {
            this.#reporter.captureError(error, context);

            return true;
        } catch {
            return false;
        }
    }
}
