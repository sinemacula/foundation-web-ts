/**
 * Component tests for dashboard-view.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { installColorScheme } from '@sinemacula/web-core/app/services';
import { Environment } from '@sinemacula/foundation/config/environment';
import { ObjectEnvironmentSource } from '@sinemacula/foundation/config/object-environment-source';
import type { LocaleSwitcher } from '@sinemacula/web-core/i18n/application-i18n';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { sessionContext } from '@sinemacula/web-core/session/session-context';
import { useSessionStore } from '@sinemacula/web-core/session/session-store';
import type { ColorSchemeService } from '@sinemacula/foundation/theme/color-scheme-service';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createApp } from 'vue';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';

import { AUTH_ROUTE_NAMES } from '@/modules/auth/route-names';
import DashboardView from '@/modules/dashboard/views/dashboard-view.vue';
import { initialiseApi, resetApi } from '@/services/api';
import { initialiseConfiguration, resetConfiguration } from '@/services/config';
import { initialiseLocaleSwitcher, resetLocaleSwitcher } from '@/services/locale';
import { initialiseStorage, resetStorage } from '@/services/storage';
import { FakeHttpClient } from '@/test-support/fake-http-client';
import { installTestSession, resetSessionContext } from '@/test-support/install-test-session';

const SESSION_KEY = 'auth.session';

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
 * Build a record from pairs so non-camelCase keys avoid object-literal keys.
 */
function wire(entries: ReadonlyArray<readonly [string, string]>): Record<string, string> {
    return Object.fromEntries(entries);
}

/** A mounted DashboardView and the handles a test drives it through. */
interface MountedDashboardView {
    /** The DOM element the view is mounted into. */
    readonly container: HTMLDivElement;

    /** The router the view navigates with. */
    readonly router: ReturnType<typeof createRouter>;

    /** Unmount the app and detach the container. */
    readonly unmount: () => void;
}

/**
 * Mount DashboardView with the minimal plugins it needs.
 */
function mountDashboardView(): MountedDashboardView {
    const pinia = createPinia();
    const i18n = createI18n({ legacy: false, locale: 'en-US', messages: {} });
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', component: DashboardView },
            { path: '/login', name: AUTH_ROUTE_NAMES.login, component: { template: '<div />' } },
        ],
    });

    const container = document.createElement('div') as HTMLDivElement;

    document.body.appendChild(container);

    const app = createApp(DashboardView);

    setActivePinia(pinia);
    app.use(pinia).use(i18n).use(router);
    app.mount(container);

    return {
        container,
        router,
        unmount: () => {
            app.unmount();
            container.remove();
        },
    };
}

describe('DashboardView', () => {
    let storage: MemoryStorage;

    beforeEach(() => {
        storage = new MemoryStorage();
        storage.set(
            SESSION_KEY,
            JSON.stringify({
                revision: 1,
                tokens: { accessToken: 'valid-token', refreshToken: 'refresh-token', expiresAtEpochMs: null },
            }),
        );
        initialiseStorage(storage);
        installTestSession(storage);
        initialiseApi(new FakeHttpClient());
        initialiseConfiguration(new Environment(new ObjectEnvironmentSource(wire([['APP_NAME', 'TestApp']]))));
        initialiseLocaleSwitcher(stubLocaleSwitcher);
        installColorScheme(stubColorScheme);
        setActivePinia(createPinia());
    });

    afterEach(() => {
        resetApi();
        resetStorage();
        resetConfiguration();
        resetLocaleSwitcher();
        resetSessionContext();
    });

    it('renders the dashboard card', () => {
        const { container, unmount } = mountDashboardView();

        expect(container.querySelector('.dashboard__welcome')).not.toBeNull();

        unmount();
    });

    it('signs out of the session and navigates to login', async () => {
        const fake = new FakeHttpClient();

        initialiseApi(fake);

        const { container, router, unmount } = mountDashboardView();

        await router.isReady();
        await sessionContext().ready();

        expect(useSessionStore().isAuthenticated).toBe(true);

        const pushSpy = vi.spyOn(router, 'push');

        const signOutButton = container.querySelector('.sm-button');

        if (signOutButton === null) {
            throw new Error('sign-out button not found');
        }

        signOutButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        await new Promise<void>(resolve => setTimeout(resolve, 50));

        expect(pushSpy).toHaveBeenCalledWith({ name: AUTH_ROUTE_NAMES.login });
        expect(fake.calls).toEqual([
            { method: 'POST', path: 'auth/logout', body: wire([['refresh_token', 'refresh-token']]) },
        ]);
        expect(useSessionStore().isAuthenticated).toBe(false);
        expect(JSON.parse(storage.get(SESSION_KEY) ?? 'null')).toEqual({ revision: 2, tokens: null });

        unmount();
    });
});
