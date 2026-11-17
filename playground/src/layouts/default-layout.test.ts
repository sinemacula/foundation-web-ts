/**
 * Component tests for default-layout.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { installColorScheme } from '@sinemacula/web-core/app/services';
import { Environment } from '@sinemacula/foundation/config/environment';
import { ObjectEnvironmentSource } from '@sinemacula/foundation/config/object-environment-source';
import type { LocaleSwitcher } from '@sinemacula/web-core/i18n/application-i18n';
import type { SessionUser } from '@sinemacula/foundation/session/session-user';
import { useSessionStore } from '@sinemacula/web-core/session/session-store';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import type { ColorSchemeService } from '@sinemacula/foundation/theme/color-scheme-service';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computed, createApp, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';

import DefaultLayout from '@/layouts/default-layout.vue';
import { initialiseConfiguration, resetConfiguration } from '@/services/config';
import { initialiseLocaleSwitcher, resetLocaleSwitcher } from '@/services/locale';
import { installTestSession, resetSessionContext } from '@/test-support/install-test-session';

/** No-op locale switcher for the layout's locale switcher. */
const stubLocaleSwitcher: LocaleSwitcher = {
    current: computed(() => 'en-US'),
    switchTo: async () => undefined,
};

/** No-op colour-scheme service for the layout's colour-scheme switcher. */
const stubColorScheme = {
    preference: () => 'system',
    resolved: () => 'light',
    setPreference: () => undefined,
    subscribe: () => () => undefined,
} as unknown as ColorSchemeService;

/** The writable session user slot on the store state. */
interface WritableSessionUser {
    /** The signed-in user, or null when signed out. */
    user: SessionUser | null;
}

/**
 * Sign in a user holding the given permissions, or sign out with null.
 */
function signIn(permissions: readonly string[] | null): void {
    (useSessionStore() as unknown as WritableSessionUser).user =
        permissions === null ? null : { id: 'u1', email: 'alice@example.com', name: 'Alice Smith', permissions };
}

/** A mounted layout and the handles a test drives it through. */
interface MountedLayout {
    /** The element the layout is mounted into. */
    readonly container: HTMLDivElement;

    /** Unmount the layout and detach its container. */
    readonly unmount: () => void;
}

/**
 * Mount the layout with the plugins it needs.
 */
async function mountLayout(): Promise<MountedLayout> {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
    });
    const container = document.createElement('div');
    const app = createApp(DefaultLayout);

    document.body.appendChild(container);
    app.use(createI18n({ legacy: false, locale: 'en-US', messages: {} })).use(router);
    app.mount(container);
    await router.isReady();

    return {
        container,
        unmount: () => {
            app.unmount();
            container.remove();
        },
    };
}

/**
 * The paths the navigation links point at.
 */
function navTargets(container: HTMLElement): Array<string | null> {
    return Array.from(container.querySelectorAll('nav a')).map(link => link.getAttribute('href'));
}

describe('DefaultLayout', () => {
    beforeEach(() => {
        initialiseConfiguration(
            new Environment(new ObjectEnvironmentSource(Object.fromEntries([['APP_NAME', 'TestApp']]))),
        );
        initialiseLocaleSwitcher(stubLocaleSwitcher);
        installColorScheme(stubColorScheme);
        installTestSession(new MemoryStorage());
        setActivePinia(createPinia());
    });

    afterEach(() => {
        resetConfiguration();
        resetLocaleSwitcher();
        resetSessionContext();
    });

    it('renders the application name', async () => {
        const { container, unmount } = await mountLayout();

        expect(container.querySelector('.default-layout__brand')?.textContent).toBe('TestApp');

        unmount();
    });

    it.each([
        ['holds users.view', ['users.view'], ['/', '/users']],
        ['lacks users.view', ['users.create'], ['/']],
        ['is signed out', null, ['/']],
    ])('shows the users link according to whether the user %s', async (_case, permissions, expected) => {
        signIn(permissions);

        const { container, unmount } = await mountLayout();

        expect(navTargets(container)).toEqual(expected);

        unmount();
    });

    it('updates the navigation when the user permissions change', async () => {
        signIn([]);

        const { container, unmount } = await mountLayout();

        signIn(['users.view']);
        await nextTick();

        expect(navTargets(container)).toEqual(['/', '/users']);

        signIn([]);
        await nextTick();

        expect(navTargets(container)).toEqual(['/']);

        unmount();
    });
});
