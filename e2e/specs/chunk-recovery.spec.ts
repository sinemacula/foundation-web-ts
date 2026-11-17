/**
 * End-to-end specs for recovering from a lazy route chunk a stale deploy no
 * longer serves.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from '../fixtures/app';
import { SEEDED_SESSION } from '../support/api-mock';
import type { FailureGuard } from '../support/failure-guard';

/**
 * Answer the users view chunk with a 404, `times` times or for good.
 */
async function removeUsersChunk(context: BrowserContext, guard: FailureGuard, times = Infinity): Promise<void> {
    let removed = 0;

    await context.route(
        url => url.pathname.includes('users-view'),
        route => {
            if (route.request().resourceType() !== 'script' || removed >= times) {
                return route.fallback();
            }

            removed += 1;
            guard.expectFailedResource(route.request().url(), 404);

            return route.fulfill({ status: 404, body: 'Not found' });
        },
    );
}

/**
 * Record the paths of every document the main frame loads from now on.
 */
function recordDocumentLoads(page: Page): string[] {
    const loads: string[] = [];

    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            loads.push(new URL(request.url()).pathname);
        }
    });

    return loads;
}

test.describe('chunk-load recovery', { tag: '@engine' }, () => {
    test.use({ seededSession: SEEDED_SESSION });

    test('reloads once into the route whose chunk went missing', async ({
        page,
        context,
        api,
        guard,
        dashboardPage,
        usersPage,
    }) => {
        await api.usersList();
        await removeUsersChunk(context, guard, 1);

        const documentLoads = recordDocumentLoads(page);

        await dashboardPage.goto();
        await expect(dashboardPage.heading).toBeVisible();

        await page.getByRole('link', { name: 'Users' }).click();

        await expect(usersPage.rows).toHaveCount(2);
        await expect(page).toHaveURL(/\/users$/u);
        expect(documentLoads).toEqual(['/', '/users']);
    });

    test('does not reload again when the chunk is still missing', async ({ page, context, guard, dashboardPage }) => {
        guard.allowConsoleError(/^Application failed to start\./u);
        await removeUsersChunk(context, guard);

        const documentLoads = recordDocumentLoads(page);

        await dashboardPage.goto();
        await expect(dashboardPage.heading).toBeVisible();

        await page.getByRole('link', { name: 'Users' }).click();

        await expect(page.getByText('The application could not start.')).toBeVisible();
        expect(documentLoads).toEqual(['/', '/users']);
    });

    test('stays put rather than reload when the reload guard cannot be stored', async ({
        page,
        context,
        guard,
        dashboardPage,
    }) => {
        await removeUsersChunk(context, guard);
        await context.addInitScript(() => {
            const setItem = Storage.prototype.setItem;

            Storage.prototype.setItem = function (this: Storage, key: string, value: string): void {
                if (key.startsWith('chunk-recovery.')) {
                    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
                }

                setItem.call(this, key, value);
            };
        });

        const documentLoads = recordDocumentLoads(page);

        await dashboardPage.goto();
        await expect(dashboardPage.heading).toBeVisible();

        const chunkRequest = page.waitForResponse(response => response.url().includes('users-view'));

        await page.getByRole('link', { name: 'Users' }).click();
        await chunkRequest;
        await expect(page.getByRole('progressbar')).toHaveCount(0);

        await expect(dashboardPage.heading).toBeVisible();
        await expect(page).toHaveURL(/\/$/u);
        expect(documentLoads).toEqual(['/']);
    });
});
