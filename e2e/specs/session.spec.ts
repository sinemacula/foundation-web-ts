/**
 * End-to-end specs for token refresh, refusal and expiry.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { expect, test } from '../fixtures/app';
import { legacyTokens, SEEDED_SESSION, storedTokens } from '../support/api-mock';

const NOW = Date.parse('2026-06-01T09:00:00Z');
const EXPIRES_IN_MS = 5 * 60_000;
const REFRESH_SKEW_MS = 60_000;
const CLOCK_STEP_MS = 1_000;

test.describe('token refresh', { tag: '@engine' }, () => {
    test.use({ seededSession: SEEDED_SESSION });

    test('adopts a session an earlier release left in localStorage, clearing it there', async ({
        page,
        dashboardPage,
    }) => {
        await dashboardPage.goto();

        await expect(dashboardPage.heading).toBeVisible();
        await expect.poll(() => storedTokens(page)).toEqual(SEEDED_SESSION);
        expect(await legacyTokens(page)).toBeNull();
    });

    test('refreshes an expired access token and retries with the new one', async ({ page, api, dashboardPage }) => {
        api.expireAccessToken(SEEDED_SESSION.accessToken);
        await api.refreshRotates();

        await dashboardPage.goto();

        await expect(dashboardPage.heading).toBeVisible();
        await expect(page).toHaveURL(/\/$/u);
        await expect
            .poll(() => api.requestsTo('/users/self').map(request => request.authorization))
            .toEqual([`Bearer ${SEEDED_SESSION.accessToken}`, 'Bearer e2e-access-token-1']);
        expect(api.requestsTo('/auth/refresh').map(request => request.body)).toEqual([
            Object.fromEntries([['refresh_token', SEEDED_SESSION.refreshToken]]),
        ]);
        expect(await storedTokens(page)).toMatchObject({
            accessToken: 'e2e-access-token-1',
            refreshToken: 'e2e-refresh-token-1',
        });
    });

    test('sends a visitor whose refresh is refused to the login screen', async ({ page, api, loginPage }) => {
        api.expireAccessToken(SEEDED_SESSION.accessToken);
        await api.refreshRefused();

        await page.goto('/users');

        await expect(loginPage.heading).toBeVisible();
        await expect(page).toHaveURL(/\/login\?redirect=\/users$/u);
        await expect(page.getByRole('heading', { name: 'Access denied' })).toBeHidden();
        expect(await storedTokens(page)).toBeNull();
        expect(api.requestsTo('/auth/refresh')).toHaveLength(1);
    });
});

test.describe('proactive refresh', { tag: '@engine' }, () => {
    test.use({ seededSession: { ...SEEDED_SESSION, expiresAtEpochMs: NOW + EXPIRES_IN_MS } });

    test('refreshes once ahead of expiry without waiting for a 401', async ({ page, api, dashboardPage }) => {
        await page.clock.install({ time: NOW });
        await api.refreshRotates();

        await dashboardPage.goto();
        await expect(dashboardPage.heading).toBeVisible();
        expect(api.requestsTo('/auth/refresh')).toEqual([]);

        await page.clock.runFor(EXPIRES_IN_MS - REFRESH_SKEW_MS - CLOCK_STEP_MS);

        // Step through the window; one jump would fire the request timeout.
        for (let elapsed = 0; elapsed < REFRESH_SKEW_MS && api.requestsTo('/auth/refresh').length === 0; ) {
            await page.clock.runFor(CLOCK_STEP_MS);
            elapsed += CLOCK_STEP_MS;
        }

        expect(await page.evaluate(() => Date.now())).toBeLessThan(NOW + EXPIRES_IN_MS);
        await expect.poll(async () => (await storedTokens(page))?.accessToken).toBe('e2e-access-token-1');
        expect(api.requestsTo('/auth/refresh')).toHaveLength(1);
        await expect
            .poll(() => api.requestsTo('/users/self').map(request => request.authorization))
            .toEqual([`Bearer ${SEEDED_SESSION.accessToken}`]);
        await expect(dashboardPage.heading).toBeVisible();
    });
});
