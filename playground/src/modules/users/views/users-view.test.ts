/**
 * Component tests for users-view.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { installColorScheme } from '@sinemacula/web-core/app/services';
import { Environment } from '@sinemacula/foundation/config/environment';
import { ObjectEnvironmentSource } from '@sinemacula/foundation/config/object-environment-source';
import type { LocaleSwitcher } from '@sinemacula/web-core/i18n/application-i18n';
import type { ColorSchemeService } from '@sinemacula/foundation/theme/color-scheme-service';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computed, createApp } from 'vue';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';

import UsersView from '@/modules/users/views/users-view.vue';
import { initialiseApi, resetApi } from '@/services/api';
import { initialiseConfiguration, resetConfiguration } from '@/services/config';
import { initialiseLocaleSwitcher, resetLocaleSwitcher } from '@/services/locale';
import { FakeHttpClient } from '@/test-support/fake-http-client';

/** No-op locale switcher for DefaultLayout's locale switcher. */
const stubLocaleSwitcher: LocaleSwitcher = {
    current: computed(() => 'en-US'),
    switchTo: async () => undefined,
};

/** No-op colour-scheme service for DefaultLayout's colour-scheme switcher. */
const stubColorScheme = {
    preference: () => 'system',
    resolved: () => 'light',
    setPreference: () => undefined,
    subscribe: () => () => undefined,
} as unknown as ColorSchemeService;

/**
 * Build a record from pairs so snake_case wire keys avoid object-literal keys.
 */
function wire(entries: ReadonlyArray<readonly [string, unknown]>): Record<string, unknown> {
    return Object.fromEntries(entries);
}

/** A valid raw user row as returned by the API. */
function userRow(id: string, fullName: string): Record<string, unknown> {
    return wire([
        ['id', id],
        ['full_name', fullName],
        ['email', `${id}@example.com`],
        ['created_at', '2026-01-01 00:00:00'],
    ]);
}

/** A page-1 response for a 27-row list paged 25 at a time. */
function firstOfTwoPages(): Record<string, unknown> {
    return {
        data: [userRow('u1', 'Alice Smith')],
        meta: wire([
            ['total', 27],
            ['count', 25],
            ['continue', true],
        ]),
    };
}

/** A response that never settles, leaving its request in flight. */
const IN_FLIGHT = new Promise<never>(() => undefined);

/**
 * Find a button by its trimmed label.
 */
function button(container: HTMLElement, label: string): HTMLButtonElement {
    const found = Array.from(container.querySelectorAll('button')).find(
        candidate => candidate.textContent?.trim() === label,
    );

    if (found === undefined) {
        throw new Error(`button "${label}" not found`);
    }

    return found;
}

/**
 * Read the trimmed text of the list's state message.
 */
function stateText(container: HTMLElement): string | undefined {
    return container.querySelector('.users-view__state p, p.users-view__state')?.textContent?.trim();
}

/** Flushes pending microtasks so an in-flight fetch and DOM update settle. */
async function flushAll(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

interface MountedUsersView {
    /** The element the view is mounted into. */
    readonly container: HTMLDivElement;

    /** Unmount the view and detach its container. */
    readonly unmount: () => void;
}

/** Mount UsersView with the minimal plugins it needs. */
function mountUsersView(): MountedUsersView {
    const pinia = createPinia();
    const i18n = createI18n({
        legacy: false,
        locale: 'en-US',
        messages: { 'en-US': { users: { index: { pagination: 'Page {current} of {last}' } } } },
        // Fixed UTC so the formatted date does not depend on the host timezone.
        datetimeFormats: {
            'en-US': { short: { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' } },
        },
    });
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', component: { template: '<div />' } },
            { path: '/users', component: UsersView },
        ],
    });

    const container = document.createElement('div') as HTMLDivElement;

    document.body.appendChild(container);

    const app = createApp(UsersView);

    setActivePinia(pinia);
    app.use(pinia).use(i18n).use(router);
    app.mount(container);

    return {
        container,
        unmount: () => {
            app.unmount();
            container.remove();
        },
    };
}

/**
 * Build an env record from pairs, keeping its snake-case keys out of literals.
 */
function wireEnv(entries: ReadonlyArray<readonly [string, string]>): Record<string, string> {
    return Object.fromEntries(entries);
}

describe('UsersView', () => {
    beforeEach(() => {
        initialiseConfiguration(new Environment(new ObjectEnvironmentSource(wireEnv([['APP_NAME', 'TestApp']]))));
        initialiseLocaleSwitcher(stubLocaleSwitcher);
        installColorScheme(stubColorScheme);
        setActivePinia(createPinia());
    });

    afterEach(() => {
        resetApi();
        resetConfiguration();
        resetLocaleSwitcher();
    });

    it('renders the heading', async () => {
        const fake = new FakeHttpClient();

        fake.queueResponse({ data: [] });
        initialiseApi(fake);

        const { container, unmount } = mountUsersView();

        await flushAll();

        expect(container.querySelector('.users-view__heading')).not.toBeNull();

        unmount();
    });

    it('renders a row per user once the initial fetch resolves', async () => {
        const fake = new FakeHttpClient();

        fake.queueResponse({ data: [userRow('u1', 'Alice Smith'), userRow('u2', 'Bob Jones')] });
        initialiseApi(fake);

        const { container, unmount } = mountUsersView();

        await flushAll();

        expect(container.querySelectorAll('tbody tr')).toHaveLength(2);

        unmount();
    });

    it('formats the createdAt column with the datetime formatter', async () => {
        const fake = new FakeHttpClient();

        fake.queueResponse({ data: [userRow('u1', 'Alice Smith')] });
        initialiseApi(fake);

        const { container, unmount } = mountUsersView();

        await flushAll();

        const cells = container.querySelectorAll('tbody tr td');

        expect(cells[2]?.textContent).toBe('1/1/2026');

        unmount();
    });

    it('renders the loading state until the first page settles', async () => {
        const fake = new FakeHttpClient();

        fake.queueResponse(IN_FLIGHT);
        initialiseApi(fake);

        const { container, unmount } = mountUsersView();

        await flushAll();

        expect(stateText(container)).toBe('common.states.loading');
        expect(container.querySelector('table')).toBeNull();

        unmount();
    });

    it('renders the empty state when there are no rows', async () => {
        const fake = new FakeHttpClient();

        fake.queueResponse({ data: [] });
        initialiseApi(fake);

        const { container, unmount } = mountUsersView();

        await flushAll();

        expect(stateText(container)).toBe('common.states.empty');
        expect(container.querySelector('table')).toBeNull();

        unmount();
    });

    it('renders the error state and recovers via the retry button', async () => {
        const fake = new FakeHttpClient();

        fake.queueError(new Error('boom'));
        initialiseApi(fake);

        const { container, unmount } = mountUsersView();

        await flushAll();

        expect(stateText(container)).toBe('common.states.error');

        fake.queueResponse({ data: [userRow('u1', 'Alice Smith')] });
        button(container, 'users.index.actions.retry').click();

        await flushAll();

        expect(container.querySelectorAll('tbody tr')).toHaveLength(1);

        unmount();
    });

    it('renders the error state for a row with a malformed timestamp', async () => {
        const fake = new FakeHttpClient();

        fake.queueResponse({
            data: [{ ...userRow('u1', 'Alice Smith'), ...wire([['created_at', '2026-01-01T00:00:00Z']]) }],
        });
        initialiseApi(fake);

        const { container, unmount } = mountUsersView();

        await flushAll();

        expect(stateText(container)).toBe('common.states.error');
        expect(container.querySelector('table')).toBeNull();

        unmount();
    });

    it('retries the failed page when a later page fails', async () => {
        const fake = new FakeHttpClient();

        fake.queueResponse(firstOfTwoPages());
        fake.queueError(new Error('boom'));
        initialiseApi(fake);

        const { container, unmount } = mountUsersView();

        await flushAll();
        button(container, 'users.index.actions.nextPage').click();
        await flushAll();

        expect(stateText(container)).toBe('common.states.error');
        expect(container.querySelector('table')).toBeNull();

        fake.queueResponse(firstOfTwoPages());
        button(container, 'users.index.actions.retry').click();
        await flushAll();

        expect(fake.calls.map(call => call.options?.query?.['page'])).toEqual([1, 2, 2]);
        expect(container.querySelectorAll('tbody tr')).toHaveLength(1);

        unmount();
    });

    it('labels the current and last page', async () => {
        const fake = new FakeHttpClient();

        fake.queueResponse(firstOfTwoPages());
        initialiseApi(fake);

        const { container, unmount } = mountUsersView();

        await flushAll();

        expect(container.querySelector('.users-view__pagination-text')?.textContent).toBe('Page 1 of 2');

        unmount();
    });

    it('disables Previous on the first page and Next on the last', async () => {
        const fake = new FakeHttpClient();

        fake.queueResponse(firstOfTwoPages());
        fake.queueResponse({
            data: [userRow('u26', 'Zed Last')],
            meta: wire([
                ['total', 27],
                ['count', 2],
                ['continue', false],
            ]),
        });
        initialiseApi(fake);

        const { container, unmount } = mountUsersView();

        await flushAll();

        expect(button(container, 'users.index.actions.previousPage').disabled).toBe(true);
        expect(button(container, 'users.index.actions.nextPage').disabled).toBe(false);

        button(container, 'users.index.actions.nextPage').click();
        await flushAll();

        expect(container.querySelector('.users-view__pagination-text')?.textContent).toBe('Page 2 of 2');
        expect(button(container, 'users.index.actions.previousPage').disabled).toBe(false);
        expect(button(container, 'users.index.actions.nextPage').disabled).toBe(true);

        unmount();
    });

    it('disables paging while the next page is in flight', async () => {
        const fake = new FakeHttpClient();

        fake.queueResponse(firstOfTwoPages());
        fake.queueResponse(IN_FLIGHT);
        initialiseApi(fake);

        const { container, unmount } = mountUsersView();

        await flushAll();
        button(container, 'users.index.actions.nextPage').click();
        await flushAll();

        expect(button(container, 'users.index.actions.previousPage').disabled).toBe(true);
        expect(button(container, 'users.index.actions.nextPage').disabled).toBe(true);

        unmount();
    });

    it('updates aria-sort when a column sort button is clicked', async () => {
        const fake = new FakeHttpClient();

        fake.queueResponse({ data: [userRow('u1', 'Alice Smith')] });
        initialiseApi(fake);

        const { container, unmount } = mountUsersView();

        await flushAll();

        const sortButton = container.querySelector('.users-view__sort');
        const header = sortButton?.closest('th');

        if (sortButton === null || header === null || header === undefined) {
            throw new Error('sortable column header not found');
        }

        expect(header.getAttribute('aria-sort')).toBe('none');

        fake.queueResponse({ data: [userRow('u1', 'Alice Smith')] });
        sortButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        await flushAll();

        expect(header.getAttribute('aria-sort')).toBe('ascending');

        unmount();
    });
});
