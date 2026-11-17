/**
 * Configuration registry: one typed definition per concern, frozen at boot.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Environment } from '@sinemacula/foundation/config/environment';

import { apiConfig } from './api';
import { appConfig } from './app';
import { featureFlagsConfig } from './feature-flags';
import { localesConfig } from './locales';
import { servicesConfig } from './services';

/**
 * Resolve every configuration definition against the environment.
 */
export function defineConfiguration(env: Environment): Configuration {
    return {
        api: apiConfig(env),
        app: appConfig(env),
        featureFlags: featureFlagsConfig(env),
        locales: localesConfig(env),
        services: servicesConfig(env),
    };
}

/**
 * The fully-typed configuration tree returned by {@link defineConfiguration}.
 */
export type Configuration = {
    /** The API client configuration. */
    api: ReturnType<typeof apiConfig>;

    /** The top-level application configuration. */
    app: ReturnType<typeof appConfig>;

    /** The feature-flag configuration. */
    featureFlags: ReturnType<typeof featureFlagsConfig>;

    /** The localisation configuration. */
    locales: ReturnType<typeof localesConfig>;

    /** The third-party service configuration. */
    services: ReturnType<typeof servicesConfig>;
};
