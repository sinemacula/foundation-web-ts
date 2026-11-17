/**
 * End-to-end specs for the permission-guarded users route.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { expect, test } from '../fixtures/app';
import { UsersPage } from '../pages/users-page';
import { mockUsersList, seedAuthenticatedSession } from '../support/api-mock';

test.describe('route authorization', () => {
    test('admits an authenticated user holding the required permission', async ({ page }) => {
        await seedAuthenticatedSession(page, ['users.view']);
        await mockUsersList(page);

        const usersPage = new UsersPage(page);

        await usersPage.goto();

        await expect(usersPage.heading).toBeVisible();
        await expect(page).toHaveURL(/\/users$/u);
    });

    test('redirects an authenticated user lacking the permission to the forbidden view', async ({ page }) => {
        await seedAuthenticatedSession(page, []);

        await page.goto('/users');

        await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
        await expect(page).toHaveURL(/\/forbidden$/u);
    });
});
