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

/** The users view module, as a built chunk or a dev server source module. */
const USERS_CHUNK = /\/users-view[^/]*\.(?:js|vue)$/u;

/**
 * Answer the users view chunk with a 404, for good or, when `untilReload`, only
 * until the first document is replaced, as after a deploy the reload picks up.
 */
async function removeUsersChunk(context: BrowserContext, guard: FailureGuard, untilReload = false): Promise<void> {
    let documents = 0;

    context.on('request', request => {
        if (request.isNavigationRequest()) {
            documents += 1;
        }
    });

    await context.route(
        url => USERS_CHUNK.test(url.pathname),
        route => {
            if (untilReload && documents > 1) {
                return route.fallback();
            }

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
        await removeUsersChunk(context, guard, true);

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

        const chunkRequest = page.waitForResponse(response => USERS_CHUNK.test(new URL(response.url()).pathname));

        await page.getByRole('link', { name: 'Users' }).click();
        await chunkRequest;
        await expect(page.getByRole('progressbar')).toHaveCount(0);

        await expect(dashboardPage.heading).toBeVisible();
        await expect(page).toHaveURL(/\/$/u);
        expect(documentLoads).toEqual(['/']);
    });
});
