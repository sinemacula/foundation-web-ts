/**
 * End-to-end specs for the authentication flow.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { expect, test } from '../fixtures/app';
import { SEEDED_SESSION, storedTokens } from '../support/api-mock';

const EMAIL = 'e2e@example.com';
const PASSWORD = 'correct-horse-battery';

test.describe('authentication', { tag: '@engine' }, () => {
    test('redirects an unauthenticated visitor to the login screen', async ({ page, loginPage }) => {
        await page.goto('/');

        await expect(page).toHaveURL(/\/login/u);
        await expect(loginPage.heading).toBeVisible();
        await expect(page).toHaveTitle(/^Sign in/u);
    });

    test('returns to the originally requested route after signing in', async ({ page, api, loginPage, usersPage }) => {
        await api.signInSucceeds();
        await api.usersList();

        await usersPage.goto();

        await expect(page).toHaveURL(/\/login\?redirect=\/users$/u);

        await loginPage.signIn(EMAIL, PASSWORD);

        await expect(usersPage.heading).toBeVisible();
        await expect(page).toHaveURL(/\/users$/u);
    });

    for (const target of ['https://evil.example', '//evil.example', '/login']) {
        test(`ignores the redirect target ${target} and lands on the dashboard`, async ({
            page,
            api,
            baseURL,
            loginPage,
            dashboardPage,
        }) => {
            await api.signInSucceeds();

            await page.goto(`/login?redirect=${encodeURIComponent(target)}`);
            await loginPage.signIn(EMAIL, PASSWORD);

            await expect(dashboardPage.heading).toBeVisible();
            expect(page.url()).toBe(`${baseURL}/`);
        });
    }

    test('signs in with the entered credentials and sends the issued bearer', async ({
        page,
        api,
        loginPage,
        dashboardPage,
    }) => {
        await api.signInSucceeds();

        await loginPage.goto();
        await loginPage.signIn(EMAIL, PASSWORD);

        await expect(dashboardPage.heading).toBeVisible();
        await expect(page).toHaveURL(/\/$/u);
        await expect(page).toHaveTitle(/^Dashboard/u);

        expect(api.requestsTo('/auth/sign-in')[0]?.body).toMatchObject({ email: EMAIL, password: PASSWORD });
        expect(api.requestsTo('/users/self').map(request => request.authorization)).toEqual([
            'Bearer e2e-access-token-1',
        ]);
    });

    test('keeps the session the app wrote across a reload', async ({ page, api, loginPage, dashboardPage }) => {
        await api.signInSucceeds();

        await loginPage.goto();
        await loginPage.signIn(EMAIL, PASSWORD);
        await expect(dashboardPage.heading).toBeVisible();

        await page.reload();

        await expect(dashboardPage.heading).toBeVisible();
        await expect(page).toHaveURL(/\/$/u);
        expect((await storedTokens(page))?.accessToken).toBe('e2e-access-token-1');
        expect(api.requestsTo('/users/self').map(request => request.authorization)).toEqual([
            'Bearer e2e-access-token-1',
            'Bearer e2e-access-token-1',
        ]);
    });

    test('rejects an empty submit with field errors and sends no request', async ({ page, api, loginPage }) => {
        await loginPage.goto();
        await loginPage.submitButton.click();

        await expect(page.getByText('Enter your email address.')).toBeVisible();
        await expect(page.getByText('Enter your password.')).toBeVisible();
        await expect(page).toHaveURL(/\/login$/u);
        expect(api.requests).toEqual([]);
    });

    test('surfaces invalid credentials on the form', async ({ page, api, loginPage }) => {
        await api.signInFails();

        await loginPage.goto();
        await loginPage.signIn(EMAIL, 'wrong-password');

        await expect(loginPage.errorMessage).toBeVisible();
        await expect(page).toHaveURL(/\/login$/u);
    });

    test('keeps a sign-in that owes a further step on the login screen', async ({ page, api, loginPage }) => {
        await api.signInRequiresInteraction();

        await loginPage.goto();

        const signInResponse = page.waitForResponse('**/auth/sign-in');

        await loginPage.signIn(EMAIL, PASSWORD);
        await signInResponse;

        await expect(loginPage.submitButton).toBeEnabled();
        await expect(page).toHaveURL(/\/login$/u);
        await expect(loginPage.errorMessage).toBeHidden();
        expect(await storedTokens(page)).toBeNull();
    });
});

test.describe('signed-in visitor', { tag: '@engine' }, () => {
    test.use({ seededSession: SEEDED_SESSION });

    test('sends the stored bearer when loading the user', async ({ api, dashboardPage }) => {
        await dashboardPage.goto();

        await expect(dashboardPage.heading).toBeVisible();
        expect(api.requestsTo('/users/self').map(request => request.authorization)).toEqual([
            `Bearer ${SEEDED_SESSION.accessToken}`,
        ]);
    });

    test('is sent past the login screen', async ({ page, loginPage, dashboardPage }) => {
        await loginPage.goto();

        await expect(dashboardPage.heading).toBeVisible();
        await expect(page).toHaveURL(/\/$/u);
    });

    test('signs out back to the login screen, revoking the refresh token', async ({
        page,
        api,
        loginPage,
        dashboardPage,
    }) => {
        await api.logout();

        await dashboardPage.goto();
        await dashboardPage.signOut();

        await expect(loginPage.heading).toBeVisible();
        await expect(page).toHaveURL(/\/login$/u);
        expect(api.requestsTo('/auth/logout').map(request => request.body)).toEqual([
            Object.fromEntries([['refresh_token', SEEDED_SESSION.refreshToken]]),
        ]);
        expect(await storedTokens(page)).toBeNull();
    });

    test('does not show the dashboard again on Back after signing out', async ({
        page,
        api,
        loginPage,
        dashboardPage,
    }) => {
        await api.logout();

        await dashboardPage.goto();
        await expect(dashboardPage.heading).toBeVisible();
        await dashboardPage.signOut();
        await expect(loginPage.heading).toBeVisible();

        await page.goBack();

        await expect(loginPage.heading).toBeVisible();
        await expect(page).toHaveURL(/\/login\?redirect=\/$/u);
        await expect(dashboardPage.heading).toBeHidden();
        expect(await storedTokens(page)).toBeNull();
    });
});
