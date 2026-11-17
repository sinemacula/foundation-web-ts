/**
 * Feature-flag configuration, read from the runtime document per deploy.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Environment } from '@sinemacula/foundation/config/environment';
import type { FlagValue } from '@sinemacula/foundation/feature-flags/feature-flags';

/**
 * Feature-flag configuration resolved from the environment.
 */
export interface FeatureFlagsConfig {
    /** The resolved feature-flag set. */
    readonly flags: Readonly<Record<string, FlagValue>>;
}

/**
 * Resolve the feature-flag configuration from the environment.
 */
export function featureFlagsConfig(env: Environment): FeatureFlagsConfig {
    return {
        flags: env.json<Record<string, FlagValue>>('FEATURE_FLAGS', {}),
    };
}
