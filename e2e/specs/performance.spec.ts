/**
 * End-to-end budgets for first load, counted rather than timed: which chunks
 * load, and how many serial request waves precede the first render.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/app';
import { SEEDED_SESSION } from '../support/api-mock';
import { SERVED_BY_PREVIEW } from '../support/environment';
import { serveRuntimeEnvironment } from '../support/runtime-env-mock';

const LATENCY_MS = 500;
const MAX_BOOT_WAVES = 6;

/**
 * Record the URL of every request `page` makes from now on.
 */
function recordRequests(page: Page): string[] {
    const urls: string[] = [];

    page.on('request', request => urls.push(request.url()));

    return urls;
}

/**
 * Group request start times into waves: a request opens a new wave when it
 * starts more than half the injected latency after the current wave opened.
 */
function countWaves(startTimes: readonly number[]): number {
    let waves = 0;
    let waveStart = Number.NEGATIVE_INFINITY;

    for (const time of [...startTimes].sort((a, b) => a - b)) {
        if (time - waveStart > LATENCY_MS / 2) {
            waves += 1;
            waveStart = time;
        }
    }

    return waves;
}

test.describe('first load', () => {
    test('a guest loads the login view as its own chunk, without French or signed-in views', async ({
        page,
        loginPage,
    }) => {
        const requests = recordRequests(page);

        await loginPage.goto();
        await expect(loginPage.heading).toBeVisible();
        await page.waitForLoadState('networkidle');

        expect(requests.filter(url => /login-view/u.test(url))).not.toEqual([]);
        expect(requests.filter(url => /fr-fr|dashboard-view|users-view/iu.test(url))).toEqual([]);
    });

    test.describe('signed in', () => {
        test.use({ seededSession: SEEDED_SESSION });

        test('the dashboard loads neither the login view nor French messages until asked', async ({
            page,
            dashboardPage,
        }) => {
            const requests = recordRequests(page);

            await dashboardPage.goto();
            await expect(dashboardPage.heading).toBeVisible();
            await page.waitForLoadState('networkidle');

            expect(requests.filter(url => /dashboard-view/u.test(url))).not.toEqual([]);
            expect(requests.filter(url => /login-view|zod|vee-validate|fr-fr/iu.test(url))).toEqual([]);

            await page.getByLabel('Language').selectOption('fr-FR');

            await expect.poll(() => requests.filter(url => /fr-fr/u.test(url))).not.toEqual([]);
        });

        test('the dashboard renders within a fixed number of serial request waves', async ({
            context,
            page,
            dashboardPage,
        }) => {
            test.skip(!SERVED_BY_PREVIEW, 'the dev server serves every module separately');

            const startTimes: number[] = [];

            await serveRuntimeEnvironment(context);
            await context.route('**/*', async route => {
                await new Promise(resolve => setTimeout(resolve, LATENCY_MS));
                await route.fallback();
            });
            page.on('request', () => startTimes.push(Date.now()));

            await dashboardPage.goto();
            await expect(dashboardPage.heading).toBeVisible({ timeout: 15_000 });

            expect(countWaves(startTimes)).toBeLessThanOrEqual(MAX_BOOT_WAVES);
        });
    });
});
