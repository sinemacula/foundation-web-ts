/**
 * Stubs for the runtime environment document the app fetches at boot and polls
 * for new deployments.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { BrowserContext } from '@playwright/test';

import { API_ORIGIN, BASE_URL } from './environment';
import type { FailureGuard } from './failure-guard';

const RUNTIME_ENV = '**/runtime-env.json';

/**
 * Serve the runtime environment, reporting each of `versions` in turn and the
 * last one from then on.
 */
export async function serveRuntimeEnvironment(
    context: BrowserContext,
    versions: readonly string[] = ['1.0.0'],
): Promise<void> {
    let served = 0;

    await context.route(RUNTIME_ENV, route => {
        if (route.request().resourceType() !== 'fetch') {
            return route.fallback();
        }

        const appVersion = versions[Math.min(served, versions.length - 1)];

        served += 1;

        return route.fulfill({
            status: 200,
            json: Object.fromEntries([
                ['APP_ENV', 'e2e'],
                ['APP_VERSION', appVersion],
                ['API_URL', API_ORIGIN],
                ['APP_URL', BASE_URL],
                ['DEFAULT_LOCALE', 'en-US'],
                ['ENABLED_LOCALES', '["en-US","fr-FR"]'],
            ]),
        });
    });
}

/**
 * Answer the runtime environment fetch with `status`, failing the boot.
 */
export async function failRuntimeEnvironment(
    context: BrowserContext,
    guard: FailureGuard,
    status: number,
): Promise<void> {
    await context.route(RUNTIME_ENV, route => {
        if (route.request().resourceType() !== 'fetch') {
            return route.fallback();
        }

        guard.expectFailedResource(route.request().url(), status);

        return route.fulfill({ status, json: { message: 'Unavailable.' } });
    });
}
