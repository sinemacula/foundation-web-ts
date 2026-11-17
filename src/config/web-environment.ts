/**
 * Composition helper for the standard web application environment.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { ChainEnvironmentSource } from '@sinemacula/foundation/config/chain-environment-source';
import { Environment } from '@sinemacula/foundation/config/environment';
import { ObjectEnvironmentSource } from '@sinemacula/foundation/config/object-environment-source';
import { PrefixedEnvironmentSource } from '@sinemacula/foundation/config/prefixed-environment-source';

const DEFAULT_BUILD_TIME_PREFIX = 'VITE_';

/**
 * Thrown when required runtime configuration keys are missing or empty.
 */
export class ConfigurationError extends Error {
    /**
     * Construct a configuration error describing the missing keys.
     */
    constructor(message: string) {
        super(message);
        this.name = 'ConfigurationError';
    }
}

/**
 * Inputs for {@link createWebEnvironment}.
 */
export interface WebEnvironmentOptions {
    /** The fetched runtime document, e.g. the result of `fetchRuntimeEnvironment`. */
    readonly runtime: Readonly<Record<string, string>>;

    /** Whether this is a development build; pass `import.meta.env.DEV` so the kernel never evaluates `import.meta.env` itself. */
    readonly dev: boolean;

    /** The build-time variable record (`import.meta.env`), chained after the runtime document in development only. */
    readonly buildTimeEnv?: Readonly<Record<string, unknown>>;

    /** The prefix carried by build-time variable keys. Defaults to `VITE_`. */
    readonly buildTimePrefix?: string;

    /** Keys the runtime document must define as non-empty in production. Ignored in development. */
    readonly requiredKeys?: readonly string[];
}

/**
 * Build the application environment from the runtime document.
 *
 * In development the runtime document is chained ahead of the prefixed
 * build-time variables, so a deployed value beats a local default. In
 * production the runtime document stands alone.
 *
 * @throws {ConfigurationError} in production when required runtime keys are
 * missing or empty
 */
export function createWebEnvironment(options: WebEnvironmentOptions): Environment {
    if (options.dev) {
        return new Environment(
            new ChainEnvironmentSource([
                new ObjectEnvironmentSource(options.runtime),
                new PrefixedEnvironmentSource(
                    options.buildTimeEnv ?? {},
                    options.buildTimePrefix ?? DEFAULT_BUILD_TIME_PREFIX,
                ),
            ]),
        );
    }

    assertRequiredKeys(options.runtime, options.requiredKeys ?? []);

    return new Environment(new ObjectEnvironmentSource(options.runtime));
}

/**
 * Assert that every required key is present and non-empty.
 *
 * @throws {ConfigurationError} when any required key is missing or empty
 */
function assertRequiredKeys(runtime: Readonly<Record<string, string>>, requiredKeys: readonly string[]): void {
    const missing = requiredKeys.filter(key => {
        const value = runtime[key];

        return value === undefined || value === '';
    });

    if (missing.length > 0) {
        throw new ConfigurationError(`Runtime configuration is missing required keys: ${missing.join(', ')}.`);
    }
}
