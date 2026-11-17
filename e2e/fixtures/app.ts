/**
 * Spec fixtures; specs import `test` and `expect` from here.
 *
 * Every spec fails on an uncaught page error, a console error or an API request
 * no mock answered, in any tab of its browser context.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { test as base, expect } from '@playwright/test';

import { DashboardPage } from '../pages/dashboard-page';
import { LoginPage } from '../pages/login-page';
import { UsersPage } from '../pages/users-page';
import type { SessionTokens } from '../support/api-mock';
import { MockApi, signedInStorageState } from '../support/api-mock';
import { FailureGuard } from '../support/failure-guard';

interface AppOptions {
    /** The session persisted before the first page loads, or null for none. */
    seededSession: SessionTokens | null;
}

interface AppFixtures {
    /** The failure record every spec is checked against at teardown. */
    guard: FailureGuard;

    /** The API fake answering every tab of the context. */
    api: MockApi;

    /** The login page object. */
    loginPage: LoginPage;

    /** The dashboard page object. */
    dashboardPage: DashboardPage;

    /** The users list page object. */
    usersPage: UsersPage;
}

export const test = base.extend<AppFixtures & AppOptions>({
    seededSession: [null, { option: true }],
    storageState: async ({ seededSession, storageState }, use) => {
        await use(seededSession === null ? storageState : signedInStorageState(seededSession));
    },
    guard: [
        async ({ context }, use) => {
            const guard = new FailureGuard();

            await guard.install(context);
            await use(guard);

            expect(guard.failures, 'browser failures during the spec').toEqual([]);
        },
        { auto: true },
    ],
    api: [
        async ({ context, guard, seededSession }, use) => {
            const api = new MockApi(context, guard);

            if (seededSession !== null) {
                api.trust(seededSession);
                await api.currentUser();
            }

            await use(api);
        },
        { auto: true },
    ],
    loginPage: async ({ page }, use) => {
        await use(new LoginPage(page));
    },
    dashboardPage: async ({ page }, use) => {
        await use(new DashboardPage(page));
    },
    usersPage: async ({ page }, use) => {
        await use(new UsersPage(page));
    },
});

export { expect } from '@playwright/test';
