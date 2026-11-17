/**
 * End-to-end specs for the users list screen.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { expect, test } from '../fixtures/app';
import { UsersPage } from '../pages/users-page';
import { mockUsersList, mockUsersListServerError, seedAuthenticatedSession } from '../support/api-mock';

test.describe('users list', () => {
    test('navigates from the dashboard and lists users', async ({ page, dashboardPage }) => {
        await seedAuthenticatedSession(page);
        await mockUsersList(page);

        await dashboardPage.goto();

        const usersPage = new UsersPage(page);

        await page.getByRole('link', { name: 'Users' }).click();

        await expect(page).toHaveURL(/\/users$/u);
        await expect(usersPage.heading).toBeVisible();
        await expect(usersPage.rows).toHaveCount(2);
    });

    test('loads the next page of results', async ({ page }) => {
        await seedAuthenticatedSession(page);
        await mockUsersList(page);

        const usersPage = new UsersPage(page);

        await usersPage.goto();

        await expect(usersPage.rows).toHaveCount(2);

        await usersPage.nextButton.click();

        await expect(page.getByText('Carol Page Two')).toBeVisible();
    });

    test('sends the search term to the server after typing', async ({ page }) => {
        await seedAuthenticatedSession(page);
        await mockUsersList(page);

        const usersPage = new UsersPage(page);

        await usersPage.goto();
        await expect(usersPage.rows).toHaveCount(2);

        const requestPromise = page.waitForRequest(request => request.url().includes('/users?'));

        await usersPage.searchField.fill('alice');

        const request = await requestPromise;

        expect(new URL(request.url()).searchParams.get('search')).toBe('alice');
    });

    test('surfaces a server error as an inline error and a toast', async ({ page }) => {
        await seedAuthenticatedSession(page);
        await mockUsersListServerError(page);

        const usersPage = new UsersPage(page);

        await usersPage.goto();

        await expect(page.getByRole('main').getByText('Something went wrong. Please try again.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

        // The toast host sits outside <main>, so this alert is the toast.
        await expect(page.getByRole('alert')).toContainText('Something went wrong. Please try again.');
    });
});
