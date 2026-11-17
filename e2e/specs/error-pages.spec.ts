/**
 * End-to-end specs for the build-generated static HTTP error pages.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { expect, test } from '../fixtures/app';
import { SERVED_BY_PREVIEW } from '../support/environment';

test.describe('static error pages', () => {
    test.skip(!SERVED_BY_PREVIEW, 'error pages are only served by the production preview');

    test('serves a page for every handled status', async ({ request }) => {
        for (const status of [400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504]) {
            const response = await request.get(`/errors/${status}.html`);

            expect(response.status(), `errors/${status}.html`).toBe(200);
            expect(await response.text()).toContain(`<title>${status} `);
        }
    });

    test.describe('English browser', () => {
        test.use({ locale: 'en-US' });

        test('renders the default copy and no external references', async ({ page }) => {
            const failed: string[] = [];

            page.on('requestfailed', request => failed.push(request.url()));

            await page.goto('/errors/500.html');

            await expect(page.locator('#e-title')).toHaveText('Internal Server Error');
            await expect(page.locator('#e-message')).toHaveText('Something went wrong on our end.');
            await expect(page).toHaveTitle('500 Internal Server Error');
            await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
            expect(failed).toEqual([]);
        });
    });

    test.describe('French browser', () => {
        test.use({ locale: 'fr-FR' });

        test('localises the page to the browser language', async ({ page }) => {
            await page.goto('/errors/500.html');

            await expect(page.locator('#e-title')).toHaveText('Erreur interne du serveur');
            await expect(page.locator('#e-message')).toHaveText("Une erreur s'est produite de notre côté.");
            await expect(page.locator('#e-home')).toHaveText("Retour à la page d'accueil");
            await expect(page).toHaveTitle('500 Erreur interne du serveur');
            await expect(page.locator('html')).toHaveAttribute('lang', 'fr-FR');
        });

        test('honours an explicit stored locale over the browser language', async ({ page }) => {
            await page.addInitScript(() => window.localStorage.setItem('locale', 'en-US'));

            await page.goto('/errors/404.html');

            await expect(page.locator('#e-title')).toHaveText('Not Found');
            await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
        });

        test('applies a stored dark theme', async ({ page }) => {
            await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));

            await page.goto('/errors/404.html');

            await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        });
    });

    test.describe('Canadian French browser', () => {
        test.use({ locale: 'fr-CA' });

        test('falls back to the base language', async ({ page }) => {
            await page.goto('/errors/503.html');

            await expect(page.locator('#e-title')).toHaveText('Service indisponible');
            await expect(page.locator('html')).toHaveAttribute('lang', 'fr-FR');
        });
    });
});
