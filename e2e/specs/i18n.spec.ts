/**
 * End-to-end specs for runtime locale switching and its persistence.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { expect, test } from '../fixtures/app';
import { SEEDED_SESSION } from '../support/api-mock';

test.describe('locale switching', { tag: '@engine' }, () => {
    test.use({ seededSession: SEEDED_SESSION });

    test('switches the interface language, document language and title', async ({ page, dashboardPage }) => {
        await dashboardPage.goto();

        await expect(dashboardPage.heading).toBeVisible();
        await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');

        await page.getByLabel('Language').selectOption('fr-FR');

        await expect(page.getByRole('link', { name: 'Utilisateurs' })).toBeVisible();
        await expect(page.getByLabel('Langue')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'fr-FR');
        await expect(page).toHaveTitle(/^Tableau de bord \|/u);
    });

    test('keeps the switched language across a reload', async ({ page, dashboardPage }) => {
        await dashboardPage.goto();
        await expect(dashboardPage.heading).toBeVisible();

        await page.getByLabel('Language').selectOption('fr-FR');
        await expect(page.getByRole('link', { name: 'Utilisateurs' })).toBeVisible();

        await page.reload();

        await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'fr-FR');
        await expect(page.getByLabel('Langue')).toHaveValue('fr-FR');
        await expect(page).toHaveTitle(/^Tableau de bord \|/u);
    });
});
