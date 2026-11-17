/**
 * End-to-end specs for a browser that blocks site storage, where merely reading
 * `localStorage` throws.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { expect, test } from '../fixtures/app';

test.describe('blocked site storage', { tag: '@engine' }, () => {
    test.beforeEach(async ({ context }) => {
        await context.addInitScript(() => {
            for (const area of ['localStorage', 'sessionStorage']) {
                Object.defineProperty(window, area, {
                    configurable: true,
                    get: () => {
                        throw new DOMException('Access is denied for this document.', 'SecurityError');
                    },
                });
            }
        });
    });

    test('boots on the system scheme and still signs in for the session', async ({
        page,
        api,
        loginPage,
        dashboardPage,
    }) => {
        await api.signInSucceeds();

        await loginPage.goto();

        await expect(loginPage.heading).toBeVisible();
        await expect(page.locator('html')).not.toHaveAttribute('data-theme');

        await loginPage.signIn('e2e@example.com', 'correct-horse-battery');

        await expect(dashboardPage.heading).toBeVisible();

        await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click();

        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    });
});
