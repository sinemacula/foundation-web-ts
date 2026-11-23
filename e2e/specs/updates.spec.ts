/**
 * End-to-end specs for the deployed-version update toast and the boot failure
 * screen, both driven by the runtime environment document.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/app';
import { SEEDED_SESSION } from '../support/api-mock';
import { SERVED_BY_PREVIEW } from '../support/environment';
import { failRuntimeEnvironment, serveRuntimeEnvironment } from '../support/runtime-env-mock';

const UPDATE_TOAST = 'A new version is available. Refresh to update.';

/**
 * Tell the app its tab regained focus, which triggers a version check.
 */
async function refocus(page: Page): Promise<void> {
    await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
    });
}

/**
 * Count the requests `page` makes from now on to the runtime environment with
 * `method`: a version check is a `GET`, a reachability probe a `HEAD`.
 */
function countRuntimeRequests(page: Page, method: 'GET' | 'HEAD'): () => number {
    let count = 0;

    page.on('request', request => {
        if (request.method() === method && new URL(request.url()).pathname === '/runtime-env.json') {
            count += 1;
        }
    });

    return () => count;
}

/**
 * Advance the page clock a probe interval at a time until `done` holds.
 */
async function advanceUntil(page: Page, done: () => boolean): Promise<void> {
    await expect
        .poll(async () => {
            await page.clock.runFor(1_500);

            return done();
        })
        .toBe(true);
}

test.describe('deployed-version updates', () => {
    test.use({ seededSession: SEEDED_SESSION });

    test('shows one sticky toast once a new version is detected', async ({ context, page, dashboardPage }) => {
        await page.clock.install();
        await serveRuntimeEnvironment(context, ['1.0.0', '2.0.0']);

        await dashboardPage.goto();
        await expect(dashboardPage.heading).toBeVisible();

        await refocus(page);

        const toast = page.getByText(UPDATE_TOAST);

        await expect(toast).toBeVisible();

        await page.clock.runFor(10_000);

        const recheck = page.waitForResponse(response => new URL(response.url()).pathname === '/runtime-env.json');

        await refocus(page);
        await recheck;
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));

        await expect(toast).toBeVisible();
        await expect(toast).toHaveCount(1);
    });

    test('pauses version checks once a loss is confirmed and checks again on recovery', async ({
        context,
        page,
        dashboardPage,
        guard,
    }) => {
        guard.allowConsoleError(/ERR_INTERNET_DISCONNECTED/u);
        await page.clock.install();
        await serveRuntimeEnvironment(context);

        await dashboardPage.goto();
        await expect(dashboardPage.heading).toBeVisible();

        const versionChecks = countRuntimeRequests(page, 'GET');
        const probes = countRuntimeRequests(page, 'HEAD');

        await context.setOffline(true);
        await advanceUntil(page, () => probes() >= 6);
        await refocus(page);
        await refocus(page);

        expect(versionChecks()).toBe(0);

        await context.setOffline(false);
        await advanceUntil(page, () => versionChecks() === 1);
    });
});

test.describe('boot failure', () => {
    test.skip(!SERVED_BY_PREVIEW, 'only a production build requires the runtime environment');

    test('shows the start-up failure screen without error detail', async ({ context, page, guard }) => {
        guard.allowConsoleError(/^Application failed to start\./u);
        await failRuntimeEnvironment(context, guard, 500);

        await page.goto('/');

        await expect(page.getByText('The application could not start.')).toBeVisible();
        await expect(page.locator('#app p')).toHaveCount(0);
    });
});
