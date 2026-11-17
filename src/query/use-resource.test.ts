/**
 * Unit tests for the useResource composable.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it, vi } from 'vitest';
import { effectScope, getCurrentScope, ref } from 'vue';

import type { QueryParameters } from '@sinemacula/foundation/http/http-client';
import { filter } from '@sinemacula/foundation/query/list-filter';
import { defineListQuery } from '@sinemacula/foundation/query/list-query-definition';
import type { ListQuery } from './use-list-query';
import { useListQuery } from './use-list-query';
import type { ResourceFetcher } from './use-resource';
import { useResource } from './use-resource';

/**
 * A promise a test can resolve or reject on demand.
 */
interface Deferred<Value> {
    /** The promise the test settles on demand. */
    readonly promise: Promise<Value>;

    /** Resolve the promise with the given value. */
    readonly resolve: (value: Value) => void;

    /** Reject the promise with the given reason. */
    readonly reject: (reason: unknown) => void;
}

/**
 * Create a deferred promise so tests can control resolution timing.
 */
function createDeferred<Value>(): Deferred<Value> {
    let resolve!: (value: Value) => void;
    let reject!: (reason: unknown) => void;

    const promise = new Promise<Value>((resolveValue, rejectValue) => {
        resolve = resolveValue;
        reject = rejectValue;
    });

    return { promise, resolve, reject };
}

/**
 * One recorded fetcher call, so a test can drive each run.
 */
interface FetcherCall<Value> {
    /** The abort signal passed to the fetcher for this run. */
    readonly signal: AbortSignal;

    /** The deferred that settles this run's promise. */
    readonly deferred: Deferred<Value>;
}

/**
 * Create a `ResourceFetcher` that queues a controllable deferred per call.
 */
function createFetcherQueue<Value>(): {
    /** The fetcher to hand to the composable. */
    readonly fetcher: ResourceFetcher<Value>;

    /** Every call the fetcher has received, in order. */
    readonly calls: FetcherCall<Value>[];
} {
    const calls: FetcherCall<Value>[] = [];

    /**
     * Queue a fresh deferred for this run and hand back its promise.
     */
    const fetcher: ResourceFetcher<Value> = signal => {
        const deferred = createDeferred<Value>();

        calls.push({ signal, deferred });

        return deferred.promise;
    };

    return { fetcher, calls };
}

/**
 * Flush both the microtask queue and Vue's scheduler queue.
 */
async function flushAll(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

describe('useResource', () => {
    describe('initial fetch', () => {
        it('fetches immediately on creation by default', () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher });

            expect(calls).toHaveLength(1);
            expect(resource.isLoading.value).toBe(true);
        });

        it('resolves into data and flips isLoading back to false', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher });

            calls.at(0)?.deferred.resolve(42);
            await flushAll();

            expect(resource.data.value).toBe(42);
            expect(resource.isLoading.value).toBe(false);
        });

        it('starts with null data and no error', () => {
            const { fetcher } = createFetcherQueue<number>();
            const resource = useResource({ fetcher });

            expect(resource.data.value).toBeNull();
            expect(resource.error.value).toBeNull();
        });
    });

    describe('immediate: false', () => {
        it('does not fetch on creation', () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher, immediate: false });

            expect(calls).toHaveLength(0);
            expect(resource.isLoading.value).toBe(false);
        });

        it('still fetches once refetch is called', () => {
            const { fetcher, calls } = createFetcherQueue<number>();

            void useResource({ fetcher, immediate: false }).refetch();

            expect(calls).toHaveLength(1);
        });
    });

    describe('watch-triggered refetch', () => {
        it('refetches when the watch source changes, keeping stale data while loading', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const source = ref('a');
            const resource = useResource({ fetcher, watch: source });

            calls.at(0)?.deferred.resolve(1);
            await flushAll();

            expect(resource.data.value).toBe(1);

            source.value = 'b';
            await flushAll();

            expect(calls).toHaveLength(2);
            expect(resource.data.value).toBe(1);
            expect(resource.isLoading.value).toBe(true);

            calls.at(1)?.deferred.resolve(2);
            await flushAll();

            expect(resource.data.value).toBe(2);
        });

        it('accepts an array of watch sources', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const first = ref(1);
            const second = ref(1);

            useResource({ fetcher, watch: [first, second] });

            calls.at(0)?.deferred.resolve(1);
            await flushAll();

            second.value = 2;
            await flushAll();

            expect(calls).toHaveLength(2);
        });
    });

    describe('supersede', () => {
        it('a late-resolving superseded run does not overwrite data or flip isLoading', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher, immediate: false });

            const firstRun = resource.refetch();
            const secondRun = resource.refetch();

            expect(calls).toHaveLength(2);
            expect(calls.at(0)?.signal.aborted).toBe(true);

            calls.at(1)?.deferred.resolve(200);
            await secondRun;

            expect(resource.data.value).toBe(200);
            expect(resource.isLoading.value).toBe(false);

            calls.at(0)?.deferred.resolve(100);
            await flushAll();

            expect(resource.data.value).toBe(200);
            expect(resource.isLoading.value).toBe(false);

            await firstRun;
        });

        it('a late-rejecting superseded run is discarded and does not set error', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher, immediate: false });

            const firstRun = resource.refetch();
            const secondRun = resource.refetch();

            calls.at(1)?.deferred.resolve(50);
            await secondRun;

            expect(resource.error.value).toBeNull();

            calls.at(0)?.deferred.reject(new Error('late failure'));
            await flushAll();

            expect(resource.error.value).toBeNull();
            expect(resource.data.value).toBe(50);

            await firstRun;
        });
        it.each([
            ['resolves', (deferred?: Deferred<number>): void => deferred?.resolve(100)],
            ['rejects', (deferred?: Deferred<number>): void => deferred?.reject(new Error('late failure'))],
        ])('stays loading when a superseded run %s before the newer run settles', async (_, settle) => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher, immediate: false });

            const firstRun = resource.refetch();
            const secondRun = resource.refetch();

            settle(calls.at(0)?.deferred);
            await firstRun;

            expect(resource.isLoading.value).toBe(true);
            expect(resource.data.value).toBeNull();
            expect(resource.error.value).toBeNull();

            calls.at(1)?.deferred.resolve(200);
            await secondRun;

            expect(resource.isLoading.value).toBe(false);
            expect(resource.data.value).toBe(200);
        });
    });

    describe('abort swallowed', () => {
        it('leaves error null when the run rejects after its own abort', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher });

            resource.stop();

            expect(calls.at(0)?.signal.aborted).toBe(true);

            calls.at(0)?.deferred.reject(new DOMException('aborted', 'AbortError'));
            await flushAll();

            expect(resource.error.value).toBeNull();
            expect(resource.isLoading.value).toBe(false);
        });
    });

    describe('error handling', () => {
        it('captures a genuine rejection as error', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher });
            const failure = new Error('boom');

            calls.at(0)?.deferred.reject(failure);
            await flushAll();

            expect(resource.error.value).toBe(failure);
            expect(resource.isLoading.value).toBe(false);
        });

        it('clears the error synchronously at the start of the next run', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher, immediate: false });

            const firstRun = resource.refetch();

            calls.at(0)?.deferred.reject(new Error('boom'));
            await firstRun;

            expect(resource.error.value).toBeInstanceOf(Error);

            const secondRun = resource.refetch();

            expect(resource.error.value).toBeNull();

            calls.at(1)?.deferred.resolve(1);
            await secondRun;
        });

        it('keeps the previous data when a reload fails (stale-while-revalidate)', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher, immediate: false });

            const firstRun = resource.refetch();

            calls.at(0)?.deferred.resolve(10);
            await firstRun;

            expect(resource.data.value).toBe(10);

            const secondRun = resource.refetch();

            calls.at(1)?.deferred.reject(new Error('boom'));
            await secondRun;

            expect(resource.data.value).toBe(10);
            expect(resource.error.value).toBeInstanceOf(Error);
        });
    });

    describe('hasLoaded', () => {
        it('is false before any run has resolved', () => {
            const { fetcher } = createFetcherQueue<number>();
            const resource = useResource({ fetcher, immediate: false });

            expect(resource.hasLoaded.value).toBe(false);
        });

        it('becomes true after the first successful resolution', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher });

            calls.at(0)?.deferred.resolve(1);
            await flushAll();

            expect(resource.hasLoaded.value).toBe(true);
        });

        it('remains true after a later run fails', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher });

            calls.at(0)?.deferred.resolve(1);
            await flushAll();

            const nextRun = resource.refetch();

            calls.at(1)?.deferred.reject(new Error('boom'));
            await nextRun;

            expect(resource.hasLoaded.value).toBe(true);
        });
    });

    describe('refetch', () => {
        it('runs the fetcher again and awaits its own settlement', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher, immediate: false });

            const promise = resource.refetch();

            expect(calls).toHaveLength(1);
            expect(resource.isLoading.value).toBe(true);

            calls.at(0)?.deferred.resolve(5);
            await promise;

            expect(resource.data.value).toBe(5);
            expect(resource.isLoading.value).toBe(false);
        });
    });

    describe('stop', () => {
        it('aborts the in-flight run and stops further watch reactions', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const source = ref(1);
            const resource = useResource({ fetcher, watch: source });

            resource.stop();

            expect(calls.at(0)?.signal.aborted).toBe(true);

            source.value = 2;
            await flushAll();

            expect(calls).toHaveLength(1);
        });

        it('discards a result that resolves after stop', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher });

            resource.stop();

            expect(resource.isLoading.value).toBe(false);

            calls.at(0)?.deferred.resolve(5);
            await flushAll();

            expect(resource.data.value).toBeNull();
            expect(resource.hasLoaded.value).toBe(false);
            expect(resource.isLoading.value).toBe(false);
        });

        it('discards a failure that rejects after stop', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher });

            resource.stop();
            calls.at(0)?.deferred.reject(new Error('late failure'));
            await flushAll();

            expect(resource.error.value).toBeNull();
            expect(resource.isLoading.value).toBe(false);
        });

        it('ignores refetch after stop', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher, immediate: false });

            resource.stop();
            await resource.refetch();

            expect(calls).toHaveLength(0);
            expect(resource.isLoading.value).toBe(false);
        });

        it('starts no run when an abort listener stops the resource', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher });

            calls.at(0)?.signal.addEventListener('abort', () => resource.stop());
            await resource.refetch();

            expect(calls).toHaveLength(1);
            expect(resource.isLoading.value).toBe(false);
        });

        it('keeps only the inner run when an abort listener refetches', () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher });

            calls.at(0)?.signal.addEventListener('abort', () => void resource.refetch(), { once: true });
            void resource.refetch();

            expect(calls).toHaveLength(2);
            expect(calls.at(1)?.signal.aborted).toBe(false);
            expect(resource.isLoading.value).toBe(true);
        });

        it('is a no-op abort when called before any run has started', () => {
            const { fetcher } = createFetcherQueue<number>();
            const resource = useResource({ fetcher, immediate: false });

            expect(() => resource.stop()).not.toThrow();
        });
    });

    describe('scope-dispose cleanup', () => {
        it('stops automatically when the enclosing effect scope is disposed', async () => {
            const { fetcher, calls } = createFetcherQueue<number>();
            const source = ref(1);
            const scope = effectScope();

            const resource = scope.run(() => useResource({ fetcher, watch: source }));

            expect(resource).toBeDefined();
            expect(calls).toHaveLength(1);

            scope.stop();

            expect(calls.at(0)?.signal.aborted).toBe(true);

            source.value = 2;
            await flushAll();

            expect(calls).toHaveLength(1);
        });

        it('works without a warning when created outside any effect scope', async () => {
            expect(getCurrentScope()).toBeUndefined();

            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const { fetcher, calls } = createFetcherQueue<number>();
            const resource = useResource({ fetcher });

            calls.at(0)?.deferred.resolve(7);
            await flushAll();

            expect(resource.data.value).toBe(7);
            expect(warn).not.toHaveBeenCalled();

            warn.mockRestore();
        });
    });

    describe('paired with useListQuery', () => {
        const definition = defineListQuery({
            filters: { status: filter.equals('status'), ids: filter.anyOf('id') },
            search: filter.search(),
            sortable: ['name', 'createdAt'],
            defaultSort: { column: 'name', direction: 'asc' },
            pageSize: 10,
        });

        /** The list query shape the paired tests drive. */
        type PairedList = ListQuery<NonNullable<(typeof definition)['filters']>>;

        /**
         * Compose a list query and a resource that watches its parameters, recording each request.
         */
        function createListResource(): {
            /** The list query driving the resource. */
            readonly list: PairedList;

            /** Every fetcher call, in order. */
            readonly calls: FetcherCall<number>[];

            /** The parameters each fetcher call was made with, in order. */
            readonly requests: QueryParameters[];

            /** Dispose the effect scope holding both composables. */
            readonly dispose: () => void;
        } {
            const scope = effectScope();
            const { fetcher, calls } = createFetcherQueue<number>();
            const requests: QueryParameters[] = [];
            const list = scope.run(() => {
                const created = useListQuery(definition);

                useResource({
                    fetcher: signal => {
                        requests.push(created.parameters.value);

                        return fetcher(signal);
                    },
                    watch: created.parameters,
                });

                return created;
            });

            if (list === undefined) {
                throw new Error('The effect scope did not run.');
            }

            return { list, calls, requests, dispose: () => scope.stop() };
        }

        it('makes one request with the final parameters for a burst of changes in one tick', async () => {
            const { list, calls, requests, dispose } = createListResource();

            list.setFilter('status', 'active');
            list.search('alice');
            list.sortBy('createdAt', 'desc');
            list.goTo(3);
            await flushAll();

            expect(calls).toHaveLength(2);
            expect(requests.at(1)).toEqual(list.parameters.value);
            expect(requests.at(1)).toMatchObject({ search: 'alice', order: 'createdAt:desc', page: 3 });
            expect(calls.at(0)?.signal.aborted).toBe(true);
            expect(calls.at(1)?.signal.aborted).toBe(false);

            dispose();
        });

        it.each([
            ['setting a filter to its current value', (list: PairedList): void => list.setFilter('status', 'active')],
            ['setting a filter to an equal array', (list: PairedList): void => list.setFilter('ids', [1, 2])],
            ['adding trailing whitespace to the search', (list: PairedList): void => list.search('alice ')],
            ['re-applying the default sort', (list: PairedList): void => list.sortBy('name', 'asc')],
        ])('neither refetches nor resets the page when %s', async (_, mutate) => {
            const { list, calls, dispose } = createListResource();

            list.setFilter('status', 'active');
            list.setFilter('ids', [1, 2]);
            list.search('alice');
            list.goTo(3);
            await flushAll();

            const page = list.page.value;
            const made = calls.length;

            mutate(list);
            await flushAll();

            expect(calls).toHaveLength(made);
            expect(list.page.value).toBe(page);

            dispose();
        });

        it('does not refetch when reset leaves the query at its defaults', async () => {
            const { list, calls, dispose } = createListResource();

            list.reset();
            await flushAll();

            expect(calls).toHaveLength(1);

            dispose();
        });

        it('does not refetch when a filter is cleared and restored in one tick', async () => {
            const { list, calls, dispose } = createListResource();

            list.setFilter('status', 'active');
            await flushAll();

            list.clearFilter('status');
            list.setFilter('status', 'active');
            await flushAll();

            expect(calls).toHaveLength(2);

            dispose();
        });

        it('aborts the in-flight request when the parameters change again', async () => {
            const { list, calls, requests, dispose } = createListResource();

            calls.at(0)?.deferred.resolve(1);
            list.next();
            await flushAll();

            list.setFilter('status', 'active');
            await flushAll();

            expect(calls).toHaveLength(3);
            expect(calls.at(1)?.signal.aborted).toBe(true);
            expect(requests.at(2)).toMatchObject({ page: 1 });

            dispose();
        });
    });
});
