/**
 * Unit tests for chunk-error-recovery.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import type { RouteRecordRaw, Router } from 'vue-router';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { ErrorReporter } from '@sinemacula/foundation/reporting/error-reporter';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { installChunkErrorRecovery, isChunkLoadError } from './chunk-error-recovery';

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
        expect(storage.get('chunk-recovery./broken')).toBe('1000');
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
        expect(storage.get('chunk-recovery./broken')).toBe('61000');
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

            expect(storage.get('chunk-recovery./broken')).toBe('5000');
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
        expect(storage.get('chunk-recovery./broken')).toBeNull();
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
        expect(storage.get('chunk-recovery./broken')).toBe('1000');
    });

    it('navigates globalThis.location when no reload function is provided', async () => {
        const location = { href: '' };
        vi.stubGlobal('location', location);

        const router = buildRouter(() => Promise.reject(chunkImportError()));
        const storage = new MemoryStorage();

        installChunkErrorRecovery({ router, storage, clock: () => 1_000 });
        await navigateToBroken(router);

        expect(location.href).toBe('/broken');
    });
});

describe('isChunkLoadError', () => {
    it.each([
        'Failed to fetch dynamically imported module: /assets/chunk.js',
        'Error loading dynamically imported module',
        'Importing a module script failed',
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
