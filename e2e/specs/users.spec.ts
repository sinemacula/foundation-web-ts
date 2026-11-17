/**
 * End-to-end specs for the users list screen.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { expect, test } from '../fixtures/app';
import { SEEDED_SESSION } from '../support/api-mock';

const ERROR_COPY = 'Something went wrong. Please try again.';

test.describe('users list', () => {
    test.use({ seededSession: SEEDED_SESSION });

    test('navigates from the dashboard and lists users with the stored bearer', async ({
        page,
        api,
        dashboardPage,
        usersPage,
    }) => {
        await api.usersList();

        await dashboardPage.goto();
        await page.getByRole('link', { name: 'Users' }).click();

        await expect(page).toHaveURL(/\/users$/u);
        await expect(usersPage.heading).toBeVisible();
        await expect(usersPage.rows).toHaveCount(2);
        expect(api.requestsTo('/users').map(request => request.authorization)).toEqual([
            `Bearer ${SEEDED_SESSION.accessToken}`,
        ]);
    });

    test('loads the next page of results', async ({ page, api, usersPage }) => {
        await api.usersList();

        await usersPage.goto();

        await expect(usersPage.rows).toHaveCount(2);

        await usersPage.nextButton.click();

        await expect(page.getByText('Carol Page Two')).toBeVisible();
        expect(api.requestsTo('/users').map(request => request.url.searchParams.get('page'))).toEqual(['1', '2']);
    });

    test('sends one debounced search request after typing', async ({ page, api, usersPage }) => {
        await api.usersList();

        await usersPage.goto();
        await expect(usersPage.rows).toHaveCount(2);

        const searched = page.waitForResponse(response => new URL(response.url()).searchParams.has('search'));

        await usersPage.searchField.pressSequentially('alice', { delay: 30 });
        await searched;
        await expect(usersPage.rows).toHaveCount(2);

        const searches = api.requestsTo('/users').flatMap(request => request.url.searchParams.getAll('search'));

        expect(searches).toEqual(['alice']);
    });

    test('surfaces a server error as an inline error and a toast', async ({ page, api, usersPage }) => {
        await api.usersListServerError();

        await usersPage.goto();

        await expect(page.getByRole('main').getByText(ERROR_COPY)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

        // The toast host sits outside <main>, so this alert is the toast.
        await expect(page.getByRole('alert')).toContainText(ERROR_COPY);
    });

    test('recovers through Retry once the network is back', async ({ page, api, usersPage }) => {
        await api.usersList();
        await api.usersListDisconnectedOnce();

        await usersPage.goto();

        await expect(page.getByRole('main').getByText(ERROR_COPY)).toBeVisible();
        await expect(page.getByRole('alert')).toContainText(ERROR_COPY);

        await page.getByRole('button', { name: 'Retry' }).click();

        await expect(usersPage.rows).toHaveCount(2);
        await expect(page.getByRole('main').getByText(ERROR_COPY)).toBeHidden();
    });
});
