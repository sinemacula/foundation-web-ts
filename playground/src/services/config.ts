/**
 * App-typed configuration accessors over the kernel configuration holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { appConfig, appConfigRepository, installConfig } from '@sinemacula/foundation-web/app/services';
import { ConfigRepository } from '@sinemacula/foundation/config/config-repository';
import type { Environment } from '@sinemacula/foundation/config/environment';

import type { Configuration } from '@/config';
import { defineConfiguration } from '@/config';

export { resetFoundationWebServices as resetConfiguration } from '@sinemacula/foundation-web/app/services';

/**
 * Resolve and install the configuration tree; the boot preset does this in
 * production, so this is the test seam.
 */
export function initialiseConfiguration(env: Environment): void {
    installConfig(new ConfigRepository(defineConfiguration(env)));
}

/**
 * The fully-typed configuration tree.
 *
 * @throws Error when accessed before configuration is installed
 */
export function config(): Readonly<Configuration> {
    return appConfig<Configuration>();
}

/**
 * Resolve a value by dot-notation path, or `fallback` when it does not resolve.
 *
 * @throws Error when accessed before configuration is installed
 */
export function configValue(path: string, fallback?: unknown): unknown {
    return appConfigRepository().get(path, fallback);
}
