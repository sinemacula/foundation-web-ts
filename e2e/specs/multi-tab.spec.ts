/**
 * End-to-end specs for one session shared by several real tabs.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { expect, test } from '../fixtures/app';
import { DashboardPage } from '../pages/dashboard-page';
import { LoginPage } from '../pages/login-page';
import { UsersPage } from '../pages/users-page';
import { SEEDED_SESSION, storedTokens } from '../support/api-mock';

test.describe('session across tabs', { tag: '@engine' }, () => {
    test.describe('signed in', () => {
        test.use({ seededSession: SEEDED_SESSION });

        test('signing out in one tab sends the other to the login screen', async ({ context, api, dashboardPage }) => {
            await api.logout();

            const other = await context.newPage();
            const otherLogin = new LoginPage(other);

            await dashboardPage.goto();
            await new DashboardPage(other).goto();
            await expect(new DashboardPage(other).heading).toBeVisible();

            await dashboardPage.signOut();

            await expect(otherLogin.heading).toBeVisible();
            await expect(other).toHaveURL(/\/login\?redirect=\/$/u);
            expect(await storedTokens(other)).toBeNull();
        });

        test('a refresh in one tab keeps the other signed in on the rotated token', async ({
            context,
            page,
            api,
            usersPage,
        }) => {
            await api.usersList();
            await api.refreshRotates();

            const other = await context.newPage();
            const otherUsers = new UsersPage(other);

            await new DashboardPage(page).goto();
            await new DashboardPage(other).goto();
            await expect(new DashboardPage(other).heading).toBeVisible();

            api.expireAccessToken(SEEDED_SESSION.accessToken);

            await page.getByRole('link', { name: 'Users' }).click();
            await expect(usersPage.rows).toHaveCount(2);

            const otherList = other.waitForRequest(request => new URL(request.url()).pathname === '/users');

            await other.getByRole('link', { name: 'Users' }).click();

            expect(await (await otherList).headerValue('authorization')).toBe('Bearer e2e-access-token-1');
            await expect(otherUsers.rows).toHaveCount(2);
            await expect(other).toHaveURL(/\/users$/u);
            expect(api.requestsTo('/auth/refresh')).toHaveLength(1);
        });
    });

    test('signing in in one tab hands the session to the other', async ({ context, api, loginPage, dashboardPage }) => {
        await api.signInSucceeds();

        const other = await context.newPage();

        await loginPage.goto();
        await new LoginPage(other).goto();
        await expect(new LoginPage(other).heading).toBeVisible();

        const otherUser = other.waitForRequest(request => new URL(request.url()).pathname === '/users/self');

        await loginPage.signIn('e2e@example.com', 'correct-horse-battery');
        await expect(dashboardPage.heading).toBeVisible();

        expect(await (await otherUser).headerValue('authorization')).toBe('Bearer e2e-access-token-1');
        expect((await storedTokens(other))?.accessToken).toBe('e2e-access-token-1');
    });
});
