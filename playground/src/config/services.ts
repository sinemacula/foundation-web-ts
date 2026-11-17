/**
 * Third-party service configuration; an unset service resolves to null.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Environment } from '@sinemacula/foundation/config/environment';

/**
 * Third-party service configuration resolved from the environment.
 */
export interface ServicesConfig {
    /** Segment analytics configuration. */
    readonly segment: {
        /** The Segment write key, or null when unconfigured. */
        readonly writeKey: string | null;
    };

    /** Sentry error-reporting configuration. */
    readonly sentry: {
        /** The Sentry DSN, or null when unconfigured. */
        readonly dsn: string | null;
    };
}

/**
 * Resolve the third-party service configuration from the environment.
 */
export function servicesConfig(env: Environment): ServicesConfig {
    return {
        segment: {
            writeKey: env.string('SEGMENT_WRITE_KEY') ?? null,
        },
        sentry: {
            dsn: env.string('SENTRY_DSN') ?? null,
        },
    };
}
