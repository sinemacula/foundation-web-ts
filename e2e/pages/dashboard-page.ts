/**
 * Page object for the dashboard home screen.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Locator, Page } from '@playwright/test';

/**
 * Drives the dashboard home screen.
 */
export class DashboardPage {
    /** The Playwright page under test. */
    readonly page: Page;

    /** The dashboard heading. */
    readonly heading: Locator;

    /** The header sign out button, which asks for confirmation. */
    readonly signOutButton: Locator;

    /** The sign out confirmation dialog. */
    readonly signOutDialog: Locator;

    constructor(page: Page) {
        this.page = page;
        this.heading = page.getByRole('heading', { name: 'Dashboard' });
        this.signOutButton = page.getByRole('banner').getByRole('button', { name: 'Sign out' });
        this.signOutDialog = page.getByRole('alertdialog', { name: 'Sign out?' });
    }

    /**
     * Navigate directly to the dashboard.
     */
    async goto(): Promise<void> {
        await this.page.goto('/');
    }

    /**
     * Sign out through the header button and its confirmation dialog.
     */
    async signOut(): Promise<void> {
        await this.signOutButton.click();
        await this.signOutDialog.getByRole('button', { name: 'Sign out' }).click();
    }
}
