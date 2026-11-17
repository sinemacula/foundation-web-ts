/**
 * Unit tests for update-monitor.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateMonitor } from './update-monitor';

/**
 * Build a record from pairs, keeping non-camelCase wire keys out of object
 * literal key positions.
 */
function wire(entries: ReadonlyArray<readonly [string, string]>): Record<string, string> {
    return Object.fromEntries(entries);
}

/**
 * Build a JSON response reporting the given deployed version.
 */
function versionResponse(version: string): Response {
    return new Response(JSON.stringify(wire([['APP_VERSION', version]])), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

/**
 * Wrap a fetch implementation in a spy.
 */
function makeFetch(impl: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    return vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(impl);
}

describe('UpdateMonitor', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('notifies subscribers when the deployed version changes', async () => {
        const fetchFn = makeFetch(async () => versionResponse('2.0.0'));
        const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn });
        const handler = vi.fn();

        monitor.onUpdate(handler);
        await monitor.checkNow();

        expect(handler).toHaveBeenCalledWith('2.0.0');
    });

    it('does not notify when the deployed version matches the booted version', async () => {
        const fetchFn = makeFetch(async () => versionResponse('1.0.0'));
        const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn });
        const handler = vi.fn();

        monitor.onUpdate(handler);
        await monitor.checkNow();

        expect(handler).not.toHaveBeenCalled();
    });

    it('notifies once per new version across repeated checks', async () => {
        const fetchFn = makeFetch(async () => versionResponse('2.0.0'));
        const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn });
        const handler = vi.fn();

        monitor.onUpdate(handler);
        await monitor.checkNow();
        await monitor.checkNow();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('announces each new release once across a sequence of documents', async () => {
        const responses = [
            versionResponse('2.0.0'),
            new Response('{"other":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
            versionResponse('3.0.0'),
            versionResponse('1.0.0'),
            versionResponse('3.0.0'),
        ];
        const fetchFn = makeFetch(async () => responses.shift() as Response);
        const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn });
        const handler = vi.fn();

        monitor.onUpdate(handler);

        for (let check = 0; check < 5; check++) {
            await monitor.checkNow();
        }

        expect(handler.mock.calls).toStrictEqual([['2.0.0'], ['3.0.0']]);
    });

    it.each<[string, () => Promise<Response>]>([
        ['non-ok responses', () => Promise.resolve(new Response('{}', { status: 404 }))],
        [
            'non-ok responses carrying a version',
            async () => new Response(JSON.stringify(wire([['APP_VERSION', '2.0.0']])), { status: 500 }),
        ],
        ['transport failures', () => Promise.reject(new Error('offline'))],
        [
            'documents without a usable version',
            async () =>
                new Response('{"other":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
        ],
        ['empty version strings', async () => versionResponse('')],
        [
            'documents that are not records',
            async () => new Response('[1,2]', { status: 200, headers: { 'content-type': 'application/json' } }),
        ],
    ])('ignores %s', async (_label, impl) => {
        const fetchFn = makeFetch(impl);
        const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn });
        const handler = vi.fn();

        monitor.onUpdate(handler);
        await monitor.checkNow();

        expect(handler).not.toHaveBeenCalled();
    });

    it('supports a custom url, interval and version extractor', async () => {
        const fetchFn = makeFetch(
            async () =>
                new Response('{"release":"5"}', { status: 200, headers: { 'content-type': 'application/json' } }),
        );

        /**
         * Read the version from the payload's `release` field.
         */
        const extractVersion = (payload: unknown): string | null =>
            typeof payload === 'object' && payload !== null && 'release' in payload
                ? String((payload as Record<string, unknown>)['release'])
                : null;

        const monitor = new UpdateMonitor({
            currentVersion: '1',
            url: '/version.json',
            interval: 1_000,
            fetchFn,
            extractVersion,
        });
        const handler = vi.fn();

        monitor.onUpdate(handler);
        monitor.start();
        await vi.advanceTimersByTimeAsync(1_000);

        expect(fetchFn).toHaveBeenCalledWith('/version.json', expect.objectContaining({ cache: 'no-store' }));
        expect(handler).toHaveBeenCalledWith('5');

        monitor.stop();
    });

    it('polls on the default interval once started and stops cleanly', async () => {
        const fetchFn = makeFetch(async () => versionResponse('1.0.0'));
        const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn });

        monitor.start();
        monitor.start();
        await vi.advanceTimersByTimeAsync(300_000);

        expect(fetchFn).toHaveBeenCalledTimes(1);

        monitor.stop();
        monitor.stop();
        await vi.advanceTimersByTimeAsync(600_000);

        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('checks when the document becomes visible', () => {
        const fetchFn = makeFetch(() => Promise.resolve(versionResponse('1.0.0')));
        const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn, targetDocument: document });

        monitor.start();
        document.dispatchEvent(new Event('visibilitychange'));

        expect(fetchFn).toHaveBeenCalledTimes(1);

        monitor.stop();
        document.dispatchEvent(new Event('visibilitychange'));

        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('does not check while the document is hidden', () => {
        const fetchFn = makeFetch(async () => versionResponse('2.0.0'));
        const listeners = new Map<string, EventListener>();
        const hiddenDocument = {
            visibilityState: 'hidden',
            addEventListener: (type: string, listener: EventListener) => {
                listeners.set(type, listener);
            },
            removeEventListener: () => {
                // Not exercised in this test.
            },
        } as unknown as Document;
        const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn, targetDocument: hiddenDocument });

        monitor.start();
        listeners.get('visibilitychange')?.(new Event('visibilitychange'));

        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('stops delivering to unsubscribed handlers', async () => {
        const fetchFn = makeFetch(async () => versionResponse('2.0.0'));
        const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn });
        const handler = vi.fn();

        const unsubscribe = monitor.onUpdate(handler);
        unsubscribe();
        await monitor.checkNow();

        expect(handler).not.toHaveBeenCalled();
    });

    it('uses the global fetch when no fetch function is provided', async () => {
        const stub = makeFetch(() => Promise.resolve(versionResponse('3.0.0')));
        vi.stubGlobal('fetch', stub);

        const monitor = new UpdateMonitor({ currentVersion: '1.0.0' });
        const handler = vi.fn();

        monitor.onUpdate(handler);
        await monitor.checkNow();

        expect(handler).toHaveBeenCalledWith('3.0.0');
    });

    it('keeps polling when a subscriber throws', async () => {
        const fetchFn = makeFetch(() => Promise.resolve(versionResponse('2.0.0')));
        const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn, interval: 1_000, onError: vi.fn() });

        monitor.onUpdate(() => {
            throw new Error('subscriber failure');
        });
        monitor.start();
        await vi.advanceTimersByTimeAsync(1_000);

        expect(fetchFn).toHaveBeenCalledTimes(1);

        monitor.stop();
    });

    it('isolates a throwing subscriber and reports its error', async () => {
        const failure = new Error('subscriber failure');
        const fetchFn = makeFetch(async () => versionResponse('2.0.0'));
        const onError = vi.fn();
        const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn, onError });
        const handler = vi.fn();

        monitor.onUpdate(() => {
            throw failure;
        });
        monitor.onUpdate(handler);
        await monitor.checkNow();

        expect(handler).toHaveBeenCalledWith('2.0.0');
        expect(onError).toHaveBeenCalledWith(failure);
    });

    it('reports subscriber errors globally by default and survives a throwing sink', async () => {
        const failure = new Error('subscriber failure');
        const reportError = vi.fn();
        const fetchFn = makeFetch(async () => versionResponse('2.0.0'));
        const handler = vi.fn();

        vi.stubGlobal('reportError', reportError);

        const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn });

        monitor.onUpdate(() => {
            throw failure;
        });
        monitor.onUpdate(handler);
        await monitor.checkNow();

        expect(reportError).toHaveBeenCalledWith(failure);

        reportError.mockImplementation(() => {
            throw new Error('sink failure');
        });

        const throwingSink = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn });

        throwingSink.onUpdate(() => {
            throw failure;
        });
        throwingSink.onUpdate(handler);

        await expect(throwingSink.checkNow()).resolves.toBeUndefined();
        expect(handler).toHaveBeenCalledTimes(2);
    });

    describe('in-flight checks', () => {
        /**
         * Build a fetch whose responses are released by the test.
         */
        function deferredFetch() {
            const releases: Array<(response: Response) => void> = [];
            const fetchFn = makeFetch(
                () =>
                    new Promise<Response>(resolve => {
                        releases.push(resolve);
                    }),
            );

            return { fetchFn, releases };
        }

        it('joins overlapping checks onto one request', async () => {
            const { fetchFn, releases } = deferredFetch();
            const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn, targetDocument: document });
            const handler = vi.fn();

            monitor.onUpdate(handler);
            monitor.start();
            document.dispatchEvent(new Event('visibilitychange'));
            document.dispatchEvent(new Event('visibilitychange'));

            const manual = monitor.checkNow();

            expect(fetchFn).toHaveBeenCalledTimes(1);

            releases[0]?.(versionResponse('2.0.0'));
            await manual;

            expect(handler).toHaveBeenCalledTimes(1);

            document.dispatchEvent(new Event('visibilitychange'));

            expect(fetchFn).toHaveBeenCalledTimes(2);

            monitor.stop();
        });

        it('does not notify for a check still in flight at stop', async () => {
            const { fetchFn, releases } = deferredFetch();
            const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn });
            const handler = vi.fn();

            monitor.onUpdate(handler);

            const pending = monitor.checkNow();

            monitor.stop();
            releases[0]?.(versionResponse('2.0.0'));
            await pending;

            expect(handler).not.toHaveBeenCalled();
            expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);

            const fresh = monitor.checkNow();

            expect(fetchFn).toHaveBeenCalledTimes(2);

            releases[1]?.(versionResponse('2.0.0'));
            await fresh;

            expect(handler).toHaveBeenCalledWith('2.0.0');
        });

        it('abandons a hung request after the timeout so later checks run', async () => {
            const { fetchFn, releases } = deferredFetch();
            const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn, timeout: 2_000 });
            const handler = vi.fn();

            monitor.onUpdate(handler);

            const hung = monitor.checkNow();

            await vi.advanceTimersByTimeAsync(1_999);

            expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);

            await vi.advanceTimersByTimeAsync(1);
            await hung;

            expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);

            const next = monitor.checkNow();

            releases[0]?.(versionResponse('2.0.0'));
            releases[1]?.(versionResponse('3.0.0'));
            await next;

            expect(handler.mock.calls).toStrictEqual([['3.0.0']]);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('abandons a hung request after ten seconds by default', async () => {
            const { fetchFn } = deferredFetch();
            const monitor = new UpdateMonitor({ currentVersion: '1.0.0', fetchFn });

            void monitor.checkNow();
            await vi.advanceTimersByTimeAsync(9_999);

            expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);

            await vi.advanceTimersByTimeAsync(1);

            expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
        });
    });
});
