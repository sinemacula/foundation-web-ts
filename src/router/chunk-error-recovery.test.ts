/**
 * Unit tests for chunk-error-recovery.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import type { RouteRecordRaw, Router, RouterHistory } from 'vue-router';
import { createMemoryHistory, createRouter, createWebHashHistory, createWebHistory } from 'vue-router';

import type { ErrorReporter } from '@sinemacula/foundation/reporting/error-reporter';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { installChunkErrorRecovery, isChunkLoadError, tabRecoveryStorage } from './chunk-error-recovery';
import { createNavigationProgress } from './navigation-progress';

const EmptyComponent = defineComponent({ render: () => null });

/** Build the error a browser throws when a lazy route chunk fails to load. */
function chunkImportError(): TypeError {
    return new TypeError('Failed to fetch dynamically imported module: http://example.com/assets/broken.js');
}

/** Build a router whose `/broken` route lazy-loads via the given loader. */
function buildRouter(brokenLoader: () => Promise<never>): Router {
    const routes: RouteRecordRaw[] = [
        { path: '/', component: EmptyComponent },
        { path: '/broken', component: brokenLoader },
    ];

    return createRouter({ history: createMemoryHistory(), routes });
}

/** Build an error reporter whose methods are spies. */
function fakeReporter(): ErrorReporter {
    return { captureError: vi.fn(), captureMessage: vi.fn(), setUser: vi.fn() };
}

/** Navigate to `/broken`, swallowing the router's own rejection. */
async function navigateToBroken(router: Router): Promise<void> {
    await router.push('/broken').catch(() => {
        // The push rejects too; only the onError handler is under test.
    });
}

describe('installChunkErrorRecovery', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reloads at the target path on the first chunk-load failure and stamps the recovery window', async () => {
        const router = buildRouter(() => Promise.reject(chunkImportError()));
        const storage = new MemoryStorage();
        const reload = vi.fn();

        installChunkErrorRecovery({ router, storage, reload, clock: () => 1_000, windowMs: 60_000 });
        await navigateToBroken(router);

        expect(reload).toHaveBeenCalledWith('/broken');
        expect(storage.get('chunk-recovery.reloaded-at')).toBe('1000');
    });

    it('does not reload and reports when the same path fails again inside the window', async () => {
        const router = buildRouter(() => Promise.reject(chunkImportError()));
        const storage = new MemoryStorage();
        const reload = vi.fn();
        const reporter = fakeReporter();
        let now = 1_000;

        installChunkErrorRecovery({ router, storage, reporter, reload, clock: () => now, windowMs: 60_000 });
        await navigateToBroken(router);

        now += 30_000;
        await navigateToBroken(router);

        expect(reload).toHaveBeenCalledTimes(1);
        expect(reporter.captureError).toHaveBeenCalledWith(expect.any(TypeError), {
            source: 'router',
            path: '/broken',
        });
    });

    it('reloads again once the recovery window has elapsed', async () => {
        const router = buildRouter(() => Promise.reject(chunkImportError()));
        const storage = new MemoryStorage();
        const reload = vi.fn();
        let now = 1_000;

        installChunkErrorRecovery({ router, storage, reload, clock: () => now, windowMs: 60_000 });
        await navigateToBroken(router);

        now += 60_000;
        await navigateToBroken(router);

        expect(reload).toHaveBeenCalledTimes(2);
        expect(storage.get('chunk-recovery.reloaded-at')).toBe('61000');
    });

    it('reports without reloading when the router error is not a chunk-load failure', async () => {
        const router = buildRouter(() => Promise.reject(new Error('exploded while parsing props')));
        const storage = new MemoryStorage();
        const reload = vi.fn();
        const reporter = fakeReporter();

        installChunkErrorRecovery({ router, storage, reporter, reload, clock: () => 1_000 });
        await navigateToBroken(router);

        expect(reload).not.toHaveBeenCalled();
        expect(reporter.captureError).toHaveBeenCalledWith(expect.any(Error), { source: 'router', path: '/broken' });
    });

    it('does not throw when no reporter is present for a non-chunk error', async () => {
        const router = buildRouter(() => Promise.reject(new Error('exploded while parsing props')));
        const storage = new MemoryStorage();
        const reload = vi.fn();

        installChunkErrorRecovery({ router, storage, reload, clock: () => 1_000 });
        await navigateToBroken(router);

        expect(reload).not.toHaveBeenCalled();
    });

    it('does not throw when no reporter is present for a chunk error inside the recovery window', async () => {
        const router = buildRouter(() => Promise.reject(chunkImportError()));
        const storage = new MemoryStorage();
        const reload = vi.fn();
        let now = 1_000;

        installChunkErrorRecovery({ router, storage, reload, clock: () => now, windowMs: 60_000 });
        await navigateToBroken(router);

        now += 1_000;
        await navigateToBroken(router);

        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('uses the default window of sixty seconds when none is provided', async () => {
        const router = buildRouter(() => Promise.reject(chunkImportError()));
        const storage = new MemoryStorage();
        const reload = vi.fn();
        const reporter = fakeReporter();
        let now = 0;

        installChunkErrorRecovery({ router, storage, reporter, reload, clock: () => now });
        await navigateToBroken(router);

        now += 59_999;
        await navigateToBroken(router);

        expect(reload).toHaveBeenCalledTimes(1);
        expect(reporter.captureError).toHaveBeenCalledTimes(1);

        now += 1;
        await navigateToBroken(router);

        expect(reload).toHaveBeenCalledTimes(2);
    });

    it('uses Date.now as the default clock when none is provided', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(5_000);

        try {
            const router = buildRouter(() => Promise.reject(chunkImportError()));
            const storage = new MemoryStorage();
            const reload = vi.fn();

            installChunkErrorRecovery({ router, storage, reload });
            await navigateToBroken(router);

            expect(storage.get('chunk-recovery.reloaded-at')).toBe('5000');
        } finally {
            vi.useRealTimers();
        }
    });

    it('returns a teardown that removes the error handler', async () => {
        const router = buildRouter(() => Promise.reject(chunkImportError()));
        const storage = new MemoryStorage();
        const reload = vi.fn();
        const reporter = fakeReporter();

        const teardown = installChunkErrorRecovery({ router, storage, reporter, reload, clock: () => 1_000 });
        teardown();

        await navigateToBroken(router);

        expect(reload).not.toHaveBeenCalled();
        expect(reporter.captureError).not.toHaveBeenCalled();
        expect(storage.get('chunk-recovery.reloaded-at')).toBeNull();
    });

    it('stops recovering after teardown while earlier recoveries stand', async () => {
        const router = buildRouter(() => Promise.reject(chunkImportError()));
        const storage = new MemoryStorage();
        const reload = vi.fn();
        let now = 1_000;

        const teardown = installChunkErrorRecovery({ router, storage, reload, clock: () => now, windowMs: 60_000 });
        await navigateToBroken(router);

        expect(reload).toHaveBeenCalledTimes(1);

        teardown();
        now += 60_000;
        await navigateToBroken(router);

        expect(reload).toHaveBeenCalledTimes(1);
        expect(storage.get('chunk-recovery.reloaded-at')).toBe('1000');
    });

    it('gives each tab its own reload, keyed to the tab storage', async () => {
        const firstTab = buildRouter(() => Promise.reject(chunkImportError()));
        const secondTab = buildRouter(() => Promise.reject(chunkImportError()));
        const firstReload = vi.fn();
        const secondReload = vi.fn();

        installChunkErrorRecovery({
            router: firstTab,
            storage: new MemoryStorage(),
            reload: firstReload,
            clock: () => 1_000,
        });
        installChunkErrorRecovery({
            router: secondTab,
            storage: new MemoryStorage(),
            reload: secondReload,
            clock: () => 2_000,
        });

        await navigateToBroken(firstTab);
        await navigateToBroken(secondTab);

        expect(firstReload).toHaveBeenCalledTimes(1);
        expect(secondReload).toHaveBeenCalledTimes(1);
    });

    it('reloads at most once in the window across different paths and queries', async () => {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', component: EmptyComponent },
                { path: '/broken', component: () => Promise.reject(chunkImportError()) },
                { path: '/other', component: () => Promise.reject(chunkImportError()) },
            ],
        });
        const reload = vi.fn();
        const reporter = fakeReporter();

        installChunkErrorRecovery({ router, storage: new MemoryStorage(), reporter, reload, clock: () => 1_000 });

        await router.push('/broken?page=1').catch(() => undefined);
        await router.push('/broken?page=2').catch(() => undefined);
        await router.push('/other').catch(() => undefined);

        expect(reload).toHaveBeenCalledTimes(1);
        expect(reporter.captureError).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['a stamp later than the clock', '5000'],
        ['an unreadable stamp', 'not-a-time'],
    ])('reloads despite %s', async (_label, stamp) => {
        const router = buildRouter(() => Promise.reject(chunkImportError()));
        const storage = new MemoryStorage();
        const reload = vi.fn();

        storage.set('chunk-recovery.reloaded-at', stamp);
        installChunkErrorRecovery({ router, storage, reload, clock: () => 1_000 });
        await navigateToBroken(router);

        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('reports instead of reloading when there is no tab storage', async () => {
        const router = buildRouter(() => Promise.reject(chunkImportError()));
        const reload = vi.fn();
        const reporter = fakeReporter();

        installChunkErrorRecovery({ router, storage: null, reporter, reload, clock: () => 1_000 });
        await navigateToBroken(router);

        expect(reload).not.toHaveBeenCalled();
        expect(reporter.captureError).toHaveBeenCalledWith(expect.any(TypeError), {
            source: 'router',
            path: '/broken',
        });
    });

    it('reports instead of reloading when the stamp cannot be stored', async () => {
        const router = buildRouter(() => Promise.reject(chunkImportError()));
        const reload = vi.fn();
        const reporter = fakeReporter();
        const storage = { get: () => null, set: () => undefined, remove: () => undefined };

        installChunkErrorRecovery({ router, storage, reporter, reload, clock: () => 1_000 });
        await navigateToBroken(router);

        expect(reload).not.toHaveBeenCalled();
        expect(reporter.captureError).toHaveBeenCalledTimes(1);
    });

    it('rejects the navigation with the original chunk error when no reporter is present', async () => {
        const failure = chunkImportError();
        const router = buildRouter(() => Promise.reject(failure));

        installChunkErrorRecovery({ router, storage: new MemoryStorage(), reload: vi.fn(), clock: () => 1_000 });
        await navigateToBroken(router);

        await expect(router.push('/broken')).rejects.toBe(failure);
    });

    it('rejects the navigation with the original error when no reporter is present for a non-chunk error', async () => {
        const failure = new Error('exploded while parsing props');
        const router = buildRouter(() => Promise.reject(failure));

        installChunkErrorRecovery({ router, storage: new MemoryStorage(), reload: vi.fn() });

        await expect(router.push('/broken')).rejects.toBe(failure);
    });

    it('contains a failing recovery so later error listeners still run', async () => {
        const failure = chunkImportError();
        const router = buildRouter(() => Promise.reject(failure));
        const reporter = fakeReporter();
        const later = vi.fn();

        installChunkErrorRecovery({
            router,
            storage: new MemoryStorage(),
            reporter,
            reload: () => {
                throw new Error('navigation blocked');
            },
            clock: () => 1_000,
        });
        router.onError(later);

        await expect(router.push('/broken')).rejects.toBe(failure);
        expect(reporter.captureError).toHaveBeenCalledWith(failure, { source: 'router', path: '/broken' });
        expect(later).toHaveBeenCalledWith(failure, expect.anything(), expect.anything());
    });

    it('falls back to the console when the reporter throws, leaving navigation progress settled', async () => {
        const failure = new Error('exploded while parsing props');
        const router = buildRouter(() => Promise.reject(failure));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const reporter: ErrorReporter = {
            captureError: () => {
                throw new Error('reporter down');
            },
            captureMessage: vi.fn(),
            setUser: vi.fn(),
        };

        installChunkErrorRecovery({ router, storage: new MemoryStorage(), reporter });

        const progress = createNavigationProgress(router);

        await expect(router.push('/broken')).rejects.toBe(failure);
        expect(consoleError).toHaveBeenCalledWith(failure);
        expect(progress.isNavigating.value).toBe(false);

        progress.stop();
        consoleError.mockRestore();
    });

    describe('default reload', () => {
        /**
         * Stub the global location at `href`, recording assignments and reloads.
         */
        function stubLocation(href: string): string[] {
            const calls: string[] = [];

            vi.stubGlobal('location', {
                href,
                assign: (url: string) => calls.push(`assign ${url}`),
                reload: () => calls.push('reload'),
            });

            return calls;
        }

        /** Build a router over `history` whose `/broken` route fails to load. */
        function routerOver(history: RouterHistory): Router {
            return createRouter({
                history,
                routes: [
                    { path: '/', component: EmptyComponent },
                    { path: '/broken', component: () => Promise.reject(chunkImportError()) },
                ],
            });
        }

        it('loads the target URL under the router base', async () => {
            const router = routerOver(createWebHistory('/app/'));
            const calls = stubLocation('https://app.test/app/');

            installChunkErrorRecovery({ router, storage: new MemoryStorage(), clock: () => 1_000 });
            await navigateToBroken(router);

            expect(calls).toStrictEqual(['assign https://app.test/app/broken']);
        });

        it('loads then reloads a hash-history target, which only changes the fragment', async () => {
            const router = routerOver(createWebHashHistory('/console/'));
            const calls = stubLocation('https://app.test/console/#/');

            installChunkErrorRecovery({ router, storage: new MemoryStorage(), clock: () => 1_000 });
            await navigateToBroken(router);

            expect(calls).toStrictEqual(['assign https://app.test/console/#/broken', 'reload']);
        });

        it.each([
            ['path', 'https://app.test/app/other'],
            ['query', 'https://app.test/app/broken?tab=1'],
        ])('only loads a target with a fragment whose %s differs from the current URL', async (_part, current) => {
            const router = routerOver(createWebHistory('/app/'));
            const calls = stubLocation(current);

            installChunkErrorRecovery({ router, storage: new MemoryStorage(), clock: () => 1_000 });
            await router.push('/broken#section').catch(() => undefined);

            expect(calls).toStrictEqual(['assign https://app.test/app/broken#section']);
        });
    });
});

describe('tabRecoveryStorage', () => {
    it('stores through the window session storage', () => {
        const values = new Map<string, string>();
        const sessionStorage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        };

        tabRecoveryStorage({ sessionStorage } as unknown as Window)?.set('key', 'value');

        expect(values.get('key')).toBe('value');
    });

    it('returns null when the browser refuses session storage access', () => {
        const targetWindow = {
            get sessionStorage(): Storage {
                throw new DOMException('denied', 'SecurityError');
            },
        } as unknown as Window;

        expect(tabRecoveryStorage(targetWindow)).toBeNull();
    });
});

describe('isChunkLoadError', () => {
    it.each([
        'Failed to fetch dynamically imported module: /assets/chunk.js',
        'Error loading dynamically imported module',
        'Importing a module script failed',
        'Unable to preload CSS for /assets/users-view.css',
    ])('matches "%s"', message => {
        expect(isChunkLoadError(new Error(message))).toBe(true);
    });

    it('returns false for an unrelated error message', () => {
        expect(isChunkLoadError(new Error('exploded while parsing props'))).toBe(false);
    });

    it('returns false for non-Error values', () => {
        expect(isChunkLoadError('failed to fetch dynamically imported module')).toBe(false);
        expect(isChunkLoadError({ message: 'failed to fetch dynamically imported module' })).toBe(false);
        expect(isChunkLoadError(null)).toBe(false);
        expect(isChunkLoadError(undefined)).toBe(false);
    });
});
