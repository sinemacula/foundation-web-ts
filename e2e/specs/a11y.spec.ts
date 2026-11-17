/**
 * Axe WCAG 2.1 A/AA checks for key screens and states in light and dark mode.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { expect, test } from '../fixtures/app';
import { expectNoA11yViolations } from '../support/a11y';
import { SEEDED_SESSION } from '../support/api-mock';

for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`accessibility (${colorScheme} mode)`, () => {
        test.use({ colorScheme });

        test('login screen has no axe violations', async ({ page, loginPage }) => {
            await loginPage.goto();

            await expect(loginPage.heading).toBeVisible();

            await expectNoA11yViolations(page);
        });

        test('login screen with field errors has no axe violations', async ({ page, loginPage }) => {
            await loginPage.goto();
            await loginPage.submitButton.click();

            await expect(page.getByText('Enter your email address.')).toBeVisible();

            await expectNoA11yViolations(page);
        });

        test('not-found view has no axe violations', async ({ page }) => {
            await page.goto('/nonsense');

            await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

            await expectNoA11yViolations(page);
        });

        test.describe('signed in', () => {
            test.use({ seededSession: SEEDED_SESSION });

            test('dashboard has no axe violations', async ({ page, dashboardPage }) => {
                await dashboardPage.goto();

                await expect(dashboardPage.heading).toBeVisible();

                await expectNoA11yViolations(page);
            });

            test('users screen has no axe violations', async ({ page, api, usersPage }) => {
                await api.usersList();

                await usersPage.goto();

                await expect(usersPage.rows).toHaveCount(2);

                await expectNoA11yViolations(page);
            });

            test('empty users screen has no axe violations', async ({ page, api, usersPage }) => {
                await api.usersListEmpty();

                await usersPage.goto();

                await expect(page.getByText('Nothing to show yet.')).toBeVisible();

                await expectNoA11yViolations(page);
            });

            test('users error state and its toast have no axe violations', async ({ page, api, usersPage }) => {
                await api.usersListServerError();

                await usersPage.goto();

                await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
                await expect(page.getByRole('alert')).toBeVisible();

                await expectNoA11yViolations(page);
            });

            test('forbidden view has no axe violations', async ({ page }) => {
                await page.goto('/forbidden');

                await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();

                await expectNoA11yViolations(page);
            });

            test('sign-out confirmation has no axe violations', async ({ page, dashboardPage }) => {
                await dashboardPage.goto();
                await dashboardPage.signOutButton.click();

                await expect(dashboardPage.signOutDialog).toBeVisible();

                await expectNoA11yViolations(page);
            });
        });
    });
}
