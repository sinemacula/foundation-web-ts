/**
 * End-to-end specs for the colour-scheme switcher and pre-paint boot script.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../fixtures/app';
import { SEEDED_SESSION } from '../support/api-mock';

const LIGHT_THEME_COLOR = '#f8fafc';
const DARK_THEME_COLOR = '#0f172a';
const RESOLVED = /--resolved/u;

/** The document root, which carries the `[data-theme]` override. */
function root(page: Page): Locator {
    return page.locator('html');
}

/** The `theme-color` meta tag the service keeps in sync with the scheme. */
function themeColor(page: Page): Locator {
    return page.locator('meta[name="theme-color"]');
}

/** The switcher group, scoping the option lookups to it. */
function switcher(page: Page): Locator {
    return page.getByRole('group', { name: 'Theme' });
}

/** One switcher option, by its visible label. */
function option(page: Page, name: string): Locator {
    return switcher(page).getByRole('button', { name });
}

/** The persisted preference, read straight from local storage. */
function storedPreference(page: Page): Promise<string | null> {
    return page.evaluate(() => window.localStorage.getItem('theme'));
}

/** The counter the page keeps of OS colour-scheme changes. */
interface SchemeChangeCounter {
    /** How many changes the listener has seen. */
    changes: number;
}

/**
 * Count OS colour-scheme changes on a listener registered after the app's, so a
 * count proves the app's own listener has already run.
 */
async function countSchemeChanges(page: Page): Promise<() => Promise<number>> {
    await page.evaluate(() => {
        const counter: SchemeChangeCounter = { changes: 0 };

        Object.assign(window, { schemeChanges: counter });
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            counter.changes += 1;
        });
    });

    return () => page.evaluate(() => Reflect.get(window, 'schemeChanges').changes as number);
}

test.describe('colour scheme switcher', { tag: '@engine' }, () => {
    test.use({ seededSession: SEEDED_SESSION });

    test('renders a three-way switcher on the authenticated layout', async ({ page, dashboardPage }) => {
        await dashboardPage.goto();

        await expect(dashboardPage.heading).toBeVisible();

        await expect(option(page, 'Light')).toBeVisible();
        await expect(option(page, 'Dark')).toBeVisible();
        await expect(option(page, 'System')).toBeVisible();
    });

    test('defaults to system with no forced theme attribute', async ({ page, dashboardPage }) => {
        await dashboardPage.goto();

        await expect(dashboardPage.heading).toBeVisible();

        await expect(root(page)).not.toHaveAttribute('data-theme');
        await expect(themeColor(page)).toHaveAttribute('content', LIGHT_THEME_COLOR);
        await expect(option(page, 'System')).toHaveAttribute('aria-pressed', 'true');
        expect(await storedPreference(page)).toBeNull();
    });

    test('applies and persists an explicit dark choice', async ({ page, dashboardPage }) => {
        await dashboardPage.goto();

        await expect(dashboardPage.heading).toBeVisible();

        await option(page, 'Dark').click();

        await expect(root(page)).toHaveAttribute('data-theme', 'dark');
        await expect(themeColor(page)).toHaveAttribute('content', DARK_THEME_COLOR);
        await expect(option(page, 'Dark')).toHaveAttribute('aria-pressed', 'true');
        await expect(option(page, 'System')).toHaveAttribute('aria-pressed', 'false');
        await expect(option(page, 'Light')).toHaveAttribute('aria-pressed', 'false');
        expect(await storedPreference(page)).toBe('dark');
    });

    test('applies and persists an explicit light choice', async ({ page, dashboardPage }) => {
        await dashboardPage.goto();

        await expect(dashboardPage.heading).toBeVisible();

        await option(page, 'Light').click();

        await expect(root(page)).toHaveAttribute('data-theme', 'light');
        await expect(themeColor(page)).toHaveAttribute('content', LIGHT_THEME_COLOR);
        await expect(option(page, 'Light')).toHaveAttribute('aria-pressed', 'true');
        await expect(option(page, 'System')).toHaveAttribute('aria-pressed', 'false');
        expect(await storedPreference(page)).toBe('light');
    });

    test('clears the override and stores system when returning to system', async ({ page, dashboardPage }) => {
        await dashboardPage.goto();

        await expect(dashboardPage.heading).toBeVisible();

        await option(page, 'Dark').click();
        await expect(root(page)).toHaveAttribute('data-theme', 'dark');

        await option(page, 'System').click();

        await expect(root(page)).not.toHaveAttribute('data-theme');
        await expect(option(page, 'System')).toHaveAttribute('aria-pressed', 'true');
        expect(await storedPreference(page)).toBe('system');
    });

    test('keeps an explicit choice when the OS scheme changes', async ({ page, dashboardPage }) => {
        await page.emulateMedia({ colorScheme: 'light' });

        await dashboardPage.goto();

        await expect(dashboardPage.heading).toBeVisible();

        await option(page, 'Dark').click();
        await expect(root(page)).toHaveAttribute('data-theme', 'dark');

        const schemeChanges = await countSchemeChanges(page);

        await page.emulateMedia({ colorScheme: 'dark' });
        await expect.poll(schemeChanges).toBe(1);
        await page.emulateMedia({ colorScheme: 'light' });
        await expect.poll(schemeChanges).toBe(2);

        await expect(root(page)).toHaveAttribute('data-theme', 'dark');
        await expect(themeColor(page)).toHaveAttribute('content', DARK_THEME_COLOR);
        expect(await storedPreference(page)).toBe('dark');
    });

    test('restores the stored preference after a reload', async ({ page, dashboardPage }) => {
        await dashboardPage.goto();

        await expect(dashboardPage.heading).toBeVisible();

        await option(page, 'Dark').click();
        await expect(root(page)).toHaveAttribute('data-theme', 'dark');

        await page.reload();

        await expect(root(page)).toHaveAttribute('data-theme', 'dark');
        await expect(option(page, 'Dark')).toHaveAttribute('aria-pressed', 'true');
    });

    test('tracks the OS scheme in both directions while deferring to the system', async ({ page, dashboardPage }) => {
        await page.emulateMedia({ colorScheme: 'dark' });

        await dashboardPage.goto();

        await expect(dashboardPage.heading).toBeVisible();

        await expect(root(page)).not.toHaveAttribute('data-theme');
        await expect(themeColor(page)).toHaveAttribute('content', DARK_THEME_COLOR);
        await expect(option(page, 'Dark')).toHaveClass(RESOLVED);

        await page.emulateMedia({ colorScheme: 'light' });

        await expect(themeColor(page)).toHaveAttribute('content', LIGHT_THEME_COLOR);
        await expect(option(page, 'Light')).toHaveClass(RESOLVED);
        await expect(option(page, 'Dark')).not.toHaveClass(RESOLVED);

        await page.emulateMedia({ colorScheme: 'dark' });

        await expect(themeColor(page)).toHaveAttribute('content', DARK_THEME_COLOR);
        await expect(option(page, 'Dark')).toHaveClass(RESOLVED);
    });

    test('renders the switcher on the users screen too', async ({ page, api, usersPage }) => {
        await api.usersList();

        await usersPage.goto();

        await expect(usersPage.heading).toBeVisible();

        await expect(option(page, 'Light')).toBeVisible();
        await expect(option(page, 'Dark')).toBeVisible();
        await expect(option(page, 'System')).toBeVisible();
    });
});

test.describe('colour scheme boot', { tag: '@engine' }, () => {
    test('stamps a stored preference before the app boots', async ({ page }) => {
        await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));

        // The service stamps only after the async boot, so at domcontentloaded
        // the attribute can only come from the pre-paint head script.
        await page.goto('/login', { waitUntil: 'domcontentloaded' });

        expect(await root(page).getAttribute('data-theme')).toBe('dark');
    });
});
