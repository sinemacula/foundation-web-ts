/**
 * Network-boundary API stubs for end-to-end specs; no real backend is used.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Page } from '@playwright/test';

/**
 * Build a record from `[key, value]` pairs, keeping snake_case wire names out
 * of object-literal keys.
 */
function wire(entries: ReadonlyArray<readonly [string, unknown]>): Record<string, unknown> {
    return Object.fromEntries(entries);
}

/**
 * Build a session response body in the default session gateway's wire shape.
 */
function sessionResponse(accessToken: string, refreshToken: string): string {
    return JSON.stringify(
        wire([
            ['access_token', accessToken],
            ['refresh_token', refreshToken],
            ['expires_in', 3600],
        ]),
    );
}

/**
 * Stub GET users/self with a fixed user holding `permissions`.
 */
async function mockGetCurrentUser(page: Page, permissions: readonly string[] = ['users.view']): Promise<void> {
    await page.route('**/users/self', route =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                data: wire([
                    ['id', 'user-1'],
                    ['first_name', 'E2E'],
                    ['last_name', 'User'],
                    ['full_name', 'E2E User'],
                    ['email', 'e2e@example.com'],
                    ['permissions', permissions],
                ]),
            }),
        }),
    );
}

/**
 * Stub a successful sign-in and the current-user fetch it triggers.
 */
export async function mockLoginSuccess(page: Page): Promise<void> {
    await page.route('**/auth/sign-in', route =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: sessionResponse('e2e-access-token', 'e2e-refresh-token'),
        }),
    );

    await mockGetCurrentUser(page);
}

/**
 * Stub sign-in with an invalid-credentials rejection.
 */
export async function mockLoginFailure(page: Page): Promise<void> {
    await page.route('**/auth/sign-in', route =>
        route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Invalid credentials.' }),
        }),
    );
}

/**
 * Stub sign-in with a pending session that owes a second factor.
 */
export async function mockLoginInteractionRequired(page: Page): Promise<void> {
    await page.route('**/auth/sign-in', route =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                wire([
                    ['pending_credential', 'e2e-pending-credential'],
                    ['requires', ['mfa']],
                ]),
            ),
        }),
    );
}

/**
 * Stub logout with a 204 No Content response.
 */
export async function mockLogout(page: Page): Promise<void> {
    await page.route('**/auth/logout', route => route.fulfill({ status: 204 }));
}

/** Build one raw user row for the mocked users-list response. */
function userRow(id: string, fullName: string): Record<string, unknown> {
    return wire([
        ['id', id],
        ['full_name', fullName],
        ['email', `${id}@example.com`],
        ['created_at', '2026-01-01 00:00:00'],
    ]);
}

/**
 * Stub GET users with two pages of rows, the second served for `page=2`.
 *
 * The glob also matches the app's `/users` route and `users-view.vue` module,
 * so only `fetch` requests are stubbed.
 */
export async function mockUsersList(page: Page): Promise<void> {
    await page.route('**/users*', route => {
        if (route.request().method() !== 'GET' || route.request().resourceType() !== 'fetch') {
            return route.fallback();
        }

        const isSecondPage = new URL(route.request().url()).searchParams.get('page') === '2';

        const body = isSecondPage
            ? {
                  data: [userRow('user-3', 'Carol Page Two'), userRow('user-4', 'Dave Page Two')],
                  meta: wire([
                      ['total', 27],
                      ['count', 2],
                      ['continue', false],
                  ]),
              }
            : {
                  data: [userRow('user-1', 'Alice Example'), userRow('user-2', 'Bob Example')],
                  meta: wire([
                      ['total', 27],
                      ['count', 25],
                      ['continue', true],
                  ]),
              };

        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
    });
}

/**
 * Stub GET users with a 500, which the default error handler raises as a toast.
 */
export async function mockUsersListServerError(page: Page): Promise<void> {
    await page.route('**/users*', route => {
        if (route.request().method() !== 'GET' || route.request().resourceType() !== 'fetch') {
            return route.fallback();
        }

        return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Server error.' }),
        });
    });
}

/**
 * Persist a signed-in session before boot and stub the current user it loads.
 */
export async function seedAuthenticatedSession(
    page: Page,
    permissions: readonly string[] = ['users.view'],
): Promise<void> {
    const snapshot = JSON.stringify({
        revision: 1,
        tokens: { accessToken: 'e2e-seeded-token', refreshToken: 'e2e-seeded-refresh-token', expiresAtEpochMs: null },
    });

    await page.addInitScript(value => window.localStorage.setItem('auth.session', value), snapshot);

    await mockGetCurrentUser(page, permissions);
}

/**
 * Stub GET users/self to 401 once, then succeed, forcing a refresh-and-retry.
 *
 * Register it after {@link seedAuthenticatedSession}: the latest route wins.
 */
export async function mockUsersSelfUnauthorizedOnce(page: Page): Promise<void> {
    let requestCount = 0;

    await page.route('**/users/self', route => {
        if (route.request().method() !== 'GET' || route.request().resourceType() !== 'fetch') {
            return route.fallback();
        }

        requestCount += 1;

        if (requestCount === 1) {
            return route.fulfill({
                status: 401,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Unauthenticated.' }),
            });
        }

        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                data: wire([
                    ['id', 'user-1'],
                    ['first_name', 'E2E'],
                    ['last_name', 'User'],
                    ['full_name', 'E2E User'],
                    ['email', 'e2e@example.com'],
                ]),
            }),
        });
    });
}

/**
 * Stub the auth refresh endpoint with a fresh session.
 *
 * @returns an accessor for the number of refresh requests observed so far
 */
export async function mockAuthRefreshSuccess(page: Page): Promise<() => number> {
    let requestCount = 0;

    await page.route('**/auth/refresh', route => {
        requestCount += 1;

        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: sessionResponse('e2e-refreshed-access-token', 'e2e-refreshed-refresh-token'),
        });
    });

    return () => requestCount;
}

/**
 * Stub the runtime environment to report a new version after the boot fetch.
 *
 * @param appUrl - echoed as APP_URL to satisfy the required-key check in builds
 */
export async function mockRuntimeEnvironmentVersionChange(page: Page, appUrl: string): Promise<void> {
    let requestCount = 0;

    await page.route('**/runtime-env.json', route => {
        if (route.request().resourceType() !== 'fetch') {
            return route.fallback();
        }

        requestCount += 1;

        const appVersion = requestCount === 1 ? '1.0.0' : '2.0.0';

        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                wire([
                    ['APP_ENV', 'e2e'],
                    ['APP_VERSION', appVersion],
                    ['API_URL', 'http://localhost:8000'],
                    ['APP_URL', appUrl],
                    ['DEFAULT_LOCALE', 'en-US'],
                    ['ENABLED_LOCALES', '["en-US"]'],
                ]),
            ),
        });
    });
}
