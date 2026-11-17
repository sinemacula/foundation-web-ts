/**
 * End-to-end specs for runtime locale switching.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { expect, test } from '../fixtures/app';
import { seedAuthenticatedSession } from '../support/api-mock';

test.describe('locale switching', () => {
    test('switches the interface language through the locale switcher', async ({ page, dashboardPage }) => {
        await seedAuthenticatedSession(page);

        await dashboardPage.goto();

        await expect(dashboardPage.heading).toBeVisible();
        await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();

        await page.getByLabel('Language').selectOption('fr-FR');

        await expect(page.getByRole('link', { name: 'Utilisateurs' })).toBeVisible();
        await expect(page.getByLabel('Langue')).toBeVisible();
    });
});
