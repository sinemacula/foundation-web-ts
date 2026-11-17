/**
 * Boot tests for the app-specific parts of the entry point's composition.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { WebCoreApp } from '@sinemacula/web-core/app/create-web-core-app';
import { resetWebCoreServices } from '@sinemacula/web-core/app/services';
import { ConfigurationError } from '@sinemacula/web-core/config/web-environment';
import { resetSessionContext } from '@sinemacula/web-core/session/session-context';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';

import { createPlaygroundApp, renderBootFailure } from '@/boot';
import type { Configuration } from '@/config';
import { AUTH_ROUTE_NAMES } from '@/modules/auth/route-names';
import { ERRORS_ROUTE_NAMES } from '@/modules/errors/route-names';
import { USERS_ROUTE_NAMES } from '@/modules/users/route-names';

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

    /** The build-time env chained behind the runtime document in development. */
    readonly buildTimeEnv?: Record<string, string>;

    /** The permissions of the signed-in user the API serves. */
    readonly permissions?: readonly string[];
}

/**
 * Build a JSON response with the given body.
 */
function json(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/**
 * The current user the API serves, holding the given permissions.
 */
function currentUser(permissions: readonly string[]): Record<string, unknown> {
    return {
        data: Object.fromEntries([
            ['id', 'u1'],
            ['first_name', 'Alice'],
            ['last_name', 'Smith'],
            ['email', 'alice@example.com'],
            ['permissions', permissions],
        ]),
    };
}

/**
 * Persist a signed-in session where the session module hydrates it from.
 */
function seedSignedInSession(): void {
    window.localStorage.setItem(
        'auth.session',
        JSON.stringify({
            revision: 1,
            tokens: { accessToken: 'access', refreshToken: 'refresh', expiresAtEpochMs: null },
        }),
    );
}

describe('application boot', () => {
    let booted: WebCoreApp<Configuration> | null = null;

    /**
     * Boot the entry point's composition through the platform seams.
     */
    async function boot(options: BootOptions = {}): Promise<WebCoreApp<Configuration>> {
        const runtime = options.runtime ?? runtimeDocument();
        const fetchFn = vi.fn((input: RequestInfo | URL) => {
            const url = String(input);

            if (url.endsWith('/runtime-env.json')) {
                return Promise.resolve(json(runtime));
            }

            return Promise.resolve(
                url.endsWith('/users/self')
                    ? json(currentUser(options.permissions ?? []))
                    : new Response(null, { status: 500 }),
            );
        });

        booted = await createPlaygroundApp({
            dev: options.dev ?? true,
            buildTimeEnv: options.buildTimeEnv ?? {},
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
        window.localStorage.clear();
    });

    it('freezes the application configuration from the fetched runtime document', async () => {
        const app = await boot();

        expect(app.config.app.name).toBe('TestApp');
        expect(app.config.api.baseUrl).toBe('http://localhost:8000');
    });

    it('boots on the browser platform when no seams are given', async () => {
        const fetchFn = vi.fn(async () => json(runtimeDocument()));

        vi.stubGlobal('fetch', fetchFn);

        try {
            booted = await createPlaygroundApp({ dev: true, buildTimeEnv: {} });
        } finally {
            vi.unstubAllGlobals();
        }

        expect(booted.config.app.name).toBe('TestApp');
        expect(fetchFn).toHaveBeenCalled();
    });

    it('falls back to build-time env in development', async () => {
        const runtime = runtimeDocument();

        delete runtime['APP_NAME'];

        const app = await boot({ runtime, buildTimeEnv: wire([['VITE_APP_NAME', 'BuildTimeApp']]) });

        expect(app.config.app.name).toBe('BuildTimeApp');
    });

    it('ignores build-time env in production', async () => {
        const app = await boot({ dev: false, buildTimeEnv: wire([['VITE_APP_NAME', 'BuildTimeApp']]) });

        expect(app.config.app.name).toBe('TestApp');
    });

    it.each([
        ['holding users.view', ['users.view'], USERS_ROUTE_NAMES.index],
        ['without users.view', ['users.create'], ERRORS_ROUTE_NAMES.forbidden],
    ])('routes a signed-in user %s visiting /users', async (_case, permissions, expected) => {
        seedSignedInSession();

        const app = await boot({ permissions });

        await app.router.push('/users');
        await app.router.isReady();

        expect(app.router.currentRoute.value.name).toBe(expected);
    });

    it('loads the shared translations and formats for the active locale', async () => {
        const app = await boot();
        const { t, d } = app.i18n.global;

        expect(t('common.actions.cancel')).toBe('Cancel');
        expect(d(new Date(Date.UTC(2026, 0, 15, 12)), 'short')).toBe('1/15/2026');
    });

    it('toasts unexpected API failures with the shared error copy', async () => {
        const app = await boot();

        await expect(app.services.http.get('reports')).rejects.toBeDefined();

        expect(app.services.toasts.toasts.value.map(toast => toast.message)).toEqual(['common.states.error']);
    });

    it('toasts a newly deployed version with the update copy', async () => {
        const runtime = runtimeDocument(wire([['APP_VERSION', '1.0.0']]));
        const app = await boot({ runtime });

        runtime['APP_VERSION'] = '1.0.1';
        await app.monitors.updates?.checkNow();

        expect(app.services.toasts.toasts.value.map(toast => toast.message)).toEqual(['common.updates.available']);
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

describe('renderBootFailure', () => {
    /**
     * Build a detached mount node holding stale content.
     */
    function mountNode(): HTMLElement {
        const mount = document.createElement('div');

        mount.innerHTML = '<span>stale</span>';

        return mount;
    }

    it('replaces the mount content with the failure notice', () => {
        const mount = mountNode();

        renderBootFailure(mount, new Error('boom'), false);

        expect(mount.textContent).toBe('The application could not start.');
        expect(mount.querySelector('span')).toBeNull();
        expect(mount.querySelector('div')?.getAttribute('style')).toBe('padding: 2rem; font-family: sans-serif;');
    });

    it('shows the error message as text in development', () => {
        const mount = mountNode();

        renderBootFailure(mount, new Error('<img src=x onerror=alert(1)>'), true);

        expect(mount.querySelector('p')?.textContent).toBe('<img src=x onerror=alert(1)>');
        expect(mount.querySelector('img')).toBeNull();
    });

    it('omits the detail for a non-error failure in development', () => {
        const mount = mountNode();

        renderBootFailure(mount, 'boom', true);

        expect(mount.querySelector('p')).toBeNull();
    });
});
