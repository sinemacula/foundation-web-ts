/**
 * End-to-end specs for keyboard-only journeys and in-flight states.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { BrowserContext } from '@playwright/test';

import { expect, test } from '../fixtures/app';
import { SEEDED_SESSION } from '../support/api-mock';

/**
 * Hold every request matching `matches` until the returned release is called.
 */
async function holdRequests(context: BrowserContext, matches: (url: URL) => boolean): Promise<() => void> {
    /**
     * Let the held requests through.
     */
    let release = (): void => undefined;
    const released = new Promise<void>(resolve => {
        release = resolve;
    });

    await context.route(matches, async route => {
        await released;
        await route.fallback();
    });

    return release;
}

test.describe('keyboard and in-flight states', () => {
    test('signs in with the keyboard alone', async ({ page, api, loginPage, dashboardPage }) => {
        await api.signInSucceeds();

        await loginPage.goto();
        await expect(loginPage.heading).toBeVisible();

        await page.keyboard.press('Tab');
        await expect(loginPage.emailField).toBeFocused();
        await page.keyboard.type('e2e@example.com');

        await page.keyboard.press('Tab');
        await expect(loginPage.passwordField).toBeFocused();
        await page.keyboard.type('correct-horse-battery');

        await page.keyboard.press('Enter');

        await expect(dashboardPage.heading).toBeVisible();
    });

    test('sends one sign-in request however often a pending form is submitted', async ({
        context,
        page,
        api,
        loginPage,
        dashboardPage,
    }) => {
        await api.signInSucceeds();

        const release = await holdRequests(context, url => url.pathname === '/auth/sign-in');
        let attempts = 0;

        page.on('request', request => {
            if (new URL(request.url()).pathname === '/auth/sign-in') {
                attempts += 1;
            }
        });

        await loginPage.goto();
        await loginPage.signIn('e2e@example.com', 'correct-horse-battery');
        await expect.poll(() => attempts).toBe(1);

        await loginPage.submitButton.click({ force: true });
        await loginPage.passwordField.press('Enter');

        release();

        await expect(dashboardPage.heading).toBeVisible();
        expect(attempts).toBe(1);
    });

    test.describe('signed in', () => {
        test.use({ seededSession: SEEDED_SESSION });

        test('reaches the users screen through the navigation by keyboard', async ({
            page,
            api,
            dashboardPage,
            usersPage,
        }) => {
            await api.usersList();

            await dashboardPage.goto();
            await expect(dashboardPage.heading).toBeVisible();

            const navigation = page.getByRole('navigation');

            await page.keyboard.press('Tab');
            await expect(navigation.getByRole('link', { name: 'Dashboard' })).toBeFocused();
            await page.keyboard.press('Tab');
            await expect(navigation.getByRole('link', { name: 'Users' })).toBeFocused();

            await page.keyboard.press('Enter');

            await expect(usersPage.rows).toHaveCount(2);
            await expect(page).toHaveURL(/\/users$/u);
        });

        test('shows the navigation progress bar while a route chunk loads', async ({
            context,
            page,
            api,
            dashboardPage,
            usersPage,
        }) => {
            await api.usersList();

            const release = await holdRequests(context, url => url.pathname.includes('users-view'));

            await dashboardPage.goto();
            await expect(dashboardPage.heading).toBeVisible();

            await page.getByRole('link', { name: 'Users' }).click();

            await expect(page.getByRole('progressbar')).toBeVisible();

            release();

            await expect(usersPage.rows).toHaveCount(2);
            await expect(page.getByRole('progressbar')).toHaveCount(0);
        });

        test('traps focus in the sign-out confirmation and restores it on cancel', async ({ page, dashboardPage }) => {
            await dashboardPage.goto();
            await expect(dashboardPage.heading).toBeVisible();

            await dashboardPage.signOutButton.click();

            const dialog = dashboardPage.signOutDialog;
            const cancel = dialog.getByRole('button', { name: 'Cancel' });
            const confirm = dialog.getByRole('button', { name: 'Sign out' });

            await expect(dialog).toBeVisible();
            await expect(cancel).toBeFocused();

            await page.keyboard.press('Tab');
            await expect(confirm).toBeFocused();
            await page.keyboard.press('Tab');
            await expect(cancel).toBeFocused();
            await page.keyboard.press('Shift+Tab');
            await expect(confirm).toBeFocused();

            await page.keyboard.press('Escape');

            await expect(dialog).toBeHidden();
            await expect(dashboardPage.signOutButton).toBeFocused();
            await expect(page).toHaveURL(/\/$/u);

            await dashboardPage.signOutButton.click();
            await cancel.click();

            await expect(dialog).toBeHidden();
            await expect(dashboardPage.signOutButton).toBeFocused();
            await expect(dashboardPage.heading).toBeVisible();
        });
    });
});
