/**
 * Boot tests for the app-specific parts of the entry point's composition.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { WebCoreApp } from '@sinemacula/web-core/app/create-web-core-app';
import { createWebCoreApp } from '@sinemacula/web-core/app/create-web-core-app';
import { resetWebCoreServices } from '@sinemacula/web-core/app/services';
import { ConfigurationError, createWebEnvironment } from '@sinemacula/web-core/config/web-environment';
import { createSessionModule } from '@sinemacula/web-core/session/create-session-module';
import { resetSessionContext } from '@sinemacula/web-core/session/session-context';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';

import App from '@/App.vue';
import type { Configuration } from '@/config';
import { defineConfiguration } from '@/config';
import { REQUIRED_RUNTIME_KEYS } from '@/config/runtime';
import { sharedLocaleLoaders } from '@/locales';
import { localeFormats } from '@/locales/formats';
import { AUTH_ROUTE_NAMES } from '@/modules/auth/route-names';
import { ERRORS_ROUTE_NAMES } from '@/modules/errors/route-names';
import { modules } from '@/modules';

/**
 * Build a record from pairs, keeping env-style keys out of object-literal keys.
 */
function wire(entries: ReadonlyArray<readonly [string, string]>): Record<string, string> {
    return Object.fromEntries(entries);
}

/**
 * A complete runtime environment document.
 */
function runtimeDocument(overrides: Record<string, string> = {}): Record<string, string> {
    return {
        ...wire([
            ['API_URL', 'http://localhost:8000'],
            ['APP_URL', 'http://localhost:5173'],
            ['APP_ENV', 'local'],
            ['APP_VERSION', 'dev'],
            ['APP_NAME', 'TestApp'],
            ['DEFAULT_LOCALE', 'en-US'],
            ['ENABLED_LOCALES', '["en-US"]'],
        ]),
        ...overrides,
    };
}

/** The options a test boot runs with. */
interface BootOptions {
    /** Whether the environment boots in development mode. */
    readonly dev?: boolean;

    /** The runtime document the fetch seam serves. */
    readonly runtime?: Record<string, string>;
}

describe('application boot', () => {
    let booted: WebCoreApp<Configuration> | null = null;

    /**
     * Boot the entry point's composition through the platform seams.
     */
    async function boot(options: BootOptions = {}): Promise<WebCoreApp<Configuration>> {
        const body = JSON.stringify(options.runtime ?? runtimeDocument());
        const fetchFn = vi.fn(
            async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
        );

        booted = await createWebCoreApp({
            root: App,
            modules: [createSessionModule(), ...modules],
            config: {
                createEnvironment: runtime =>
                    createWebEnvironment({
                        runtime,
                        dev: options.dev ?? true,
                        requiredKeys: REQUIRED_RUNTIME_KEYS,
                    }),
                define: defineConfiguration,
            },
            http: { unexpectedErrorToastKey: 'common.states.error' },
            i18n: { sharedLoaders: sharedLocaleLoaders, formats: localeFormats },
            monitors: { updates: { toastKey: 'common.updates.available' } },
            platform: {
                fetchFn,
                storage: new MemoryStorage(),
                history: createMemoryHistory(),
                targetDocument: document.implementation.createHTMLDocument('t'),
                localeCandidates: ['en-US'],
            },
        });

        return booted;
    }

    afterEach(() => {
        booted?.dispose();
        booted = null;
        resetWebCoreServices();
        resetSessionContext();
    });

    it('freezes the application configuration from the fetched runtime document', async () => {
        const app = await boot();

        expect(app.config.app.name).toBe('TestApp');
        expect(app.config.api.baseUrl).toBe('http://localhost:8000');
    });

    it('redirects an unauthenticated visit to the login route', async () => {
        const app = await boot();

        await app.router.push('/');
        await app.router.isReady();

        expect(app.router.currentRoute.value.name).toBe(AUTH_ROUTE_NAMES.login);
    });

    it('routes unknown paths to the errors module catch-all', async () => {
        const app = await boot();

        await app.router.isReady();
        await app.router.push('/definitely-not-a-route');

        expect(app.router.currentRoute.value.name).toBe(ERRORS_ROUTE_NAMES.notFound);
    });

    it('switches locales through the installed locale switcher', async () => {
        const app = await boot({ runtime: runtimeDocument(wire([['ENABLED_LOCALES', '["en-US","fr-FR"]']])) });

        await app.services.localeSwitcher.switchTo('fr-FR');

        expect(app.services.localeSwitcher.current.value).toBe('fr-FR');
    });

    it('fails closed in production when a required runtime key is missing', async () => {
        const runtime = runtimeDocument();

        delete runtime['API_URL'];

        await expect(boot({ dev: false, runtime })).rejects.toBeInstanceOf(ConfigurationError);
        await expect(boot({ dev: false, runtime })).rejects.toThrow('API_URL');
    });
});
