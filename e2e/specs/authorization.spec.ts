/**
 * End-to-end specs for the permission-guarded users route.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { expect, test } from '../fixtures/app';
import { SEEDED_SESSION } from '../support/api-mock';

test.describe('route authorization', () => {
    test.use({ seededSession: SEEDED_SESSION });

    test('admits an authenticated user holding the required permission', async ({ page, api, usersPage }) => {
        await api.usersList();

        await usersPage.goto();

        await expect(usersPage.heading).toBeVisible();
        await expect(page).toHaveURL(/\/users$/u);
    });

    test('redirects an authenticated user lacking the permission to the forbidden view', async ({ page, api }) => {
        await api.currentUser([]);

        await page.goto('/users');

        await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
        await expect(page).toHaveURL(/\/forbidden$/u);
        expect(api.requestsTo('/users')).toEqual([]);
    });

    test('hides the users link from a user lacking the permission', async ({ page, api, dashboardPage }) => {
        await api.currentUser([]);

        const userLoaded = page.waitForResponse(response => new URL(response.url()).pathname === '/users/self');

        await dashboardPage.goto();
        await userLoaded;

        await expect(dashboardPage.heading).toBeVisible();
        // Two frames let the permission-driven render settle before the check.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect(page.getByRole('navigation').getByRole('link', { name: 'Dashboard' })).toBeVisible();
        await expect(page.getByRole('navigation').getByRole('link', { name: 'Users' })).toHaveCount(0);
    });
});
