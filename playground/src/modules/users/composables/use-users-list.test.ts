/**
 * Unit tests for useUsersList.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

import { useUsersList } from '@/modules/users/composables/use-users-list';
import { initialiseApi, resetApi } from '@/services/api';
import { FakeHttpClient } from '@/test-support/fake-http-client';

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

/** Flushes pending microtasks so an in-flight fetch settles. */
async function flushAll(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

describe('useUsersList', () => {
    let fake: FakeHttpClient;

    beforeEach(() => {
        fake = new FakeHttpClient();
        initialiseApi(fake);
    });

    afterEach(() => {
        resetApi();
    });

    describe('initial fetch', () => {
        it('renders the rows and meta from the initial fetch', async () => {
            fake.queueResponse({
                data: [userRow('u1', 'Alice Smith'), userRow('u2', 'Bob Jones')],
                meta: wire([
                    ['total', 2],
                    ['count', 2],
                    ['continue', false],
                ]),
            });

            const usersList = useUsersList();

            expect(usersList.isLoading.value).toBe(true);
            expect(usersList.hasLoaded.value).toBe(false);

            await flushAll();

            expect(usersList.hasLoaded.value).toBe(true);
            expect(usersList.rows.value).toHaveLength(2);
            expect(usersList.rows.value[0]?.fullName).toBe('Alice Smith');
            expect(usersList.meta.value).toEqual({ mode: 'length-aware', total: 2, count: 2, hasMore: false });
        });

        it('starts with no rows, meta or last page', () => {
            const usersList = useUsersList();

            expect(usersList.rows.value).toEqual([]);
            expect(usersList.meta.value).toBeNull();
            expect(usersList.lastPage.value).toBeNull();
        });
    });

    describe('last page', () => {
        it('derives the last page from the total and the page size', async () => {
            fake.queueResponse({
                data: [],
                meta: wire([
                    ['total', 51],
                    ['count', 25],
                    ['continue', true],
                ]),
            });

            const usersList = useUsersList();

            await flushAll();

            expect(usersList.lastPage.value).toBe(3);
        });

        it('reports page 1 as the last page of an empty list', async () => {
            fake.queueResponse({
                data: [],
                meta: wire([
                    ['total', 0],
                    ['count', 0],
                    ['continue', false],
                ]),
            });

            const usersList = useUsersList();

            await flushAll();

            expect(usersList.lastPage.value).toBe(1);
        });

        it('has no last page for a cursor-paginated response', async () => {
            fake.queueResponse({ data: [], meta: wire([['continue', true]]) });

            const usersList = useUsersList();

            await flushAll();

            expect(usersList.lastPage.value).toBeNull();
        });
    });

    describe('search debounce', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('collapses two keystrokes within the debounce window into one query change', async () => {
            fake.queueResponse({ data: [] });
            fake.queueResponse({ data: [] });

            const usersList = useUsersList();

            await vi.advanceTimersByTimeAsync(0);
            expect(fake.calls).toHaveLength(1);

            usersList.searchInput.value = 'a';
            await vi.advanceTimersByTimeAsync(100);

            usersList.searchInput.value = 'ab';
            await vi.advanceTimersByTimeAsync(299);

            expect(usersList.searchTerm.value).toBe('');
            expect(fake.calls).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(1);

            expect(usersList.searchTerm.value).toBe('ab');
            expect(fake.calls).toHaveLength(2);
        });

        it('drops a pending search commit when the scope stops', async () => {
            fake.queueResponse({ data: [] });

            const scope = effectScope();
            const usersList = scope.run(() => useUsersList());

            if (usersList === undefined) {
                throw new Error('useUsersList did not initialise inside the effect scope');
            }

            await vi.advanceTimersByTimeAsync(0);

            usersList.searchInput.value = 'zzz';
            await vi.advanceTimersByTimeAsync(0);

            scope.stop();

            await vi.advanceTimersByTimeAsync(350);

            expect(usersList.searchTerm.value).toBe('');
            expect(fake.calls).toHaveLength(1);
        });
    });

    describe('search', () => {
        it('commits a term immediately, bypassing the debounce', async () => {
            fake.queueResponse({ data: [] });

            const usersList = useUsersList();

            await flushAll();

            usersList.search('bob');

            expect(usersList.searchTerm.value).toBe('bob');
        });
    });

    describe('sortBy', () => {
        it('updates the active sort and resets the page to 1', async () => {
            fake.queueResponse({ data: [] });

            const usersList = useUsersList();

            await flushAll();

            usersList.next();
            expect(usersList.page.value).toBe(2);

            usersList.sortBy('full_name');

            expect(usersList.sort.value).toEqual({ column: 'full_name', direction: 'asc' });
            expect(usersList.page.value).toBe(1);
        });
    });

    describe('pagination', () => {
        it('does not advance before the first page settles', () => {
            fake.queueResponse(IN_FLIGHT);

            const usersList = useUsersList();

            usersList.next();

            expect(usersList.hasNextPage.value).toBe(false);
            expect(usersList.page.value).toBe(1);
        });

        it('advances to the next page when meta reports more pages remain', async () => {
            fake.queueResponse(firstOfTwoPages());

            const usersList = useUsersList();

            await flushAll();

            expect(usersList.hasNextPage.value).toBe(true);

            usersList.next();

            expect(usersList.page.value).toBe(2);
        });

        it('advances when the settled page reports no pagination meta', async () => {
            fake.queueResponse({ data: [] });

            const usersList = useUsersList();

            await flushAll();

            usersList.next();

            expect(usersList.page.value).toBe(2);
        });

        it('does not advance past the last page when meta indicates the end', async () => {
            fake.queueResponse({
                data: [],
                meta: wire([
                    ['total', 5],
                    ['count', 5],
                    ['continue', false],
                ]),
            });

            const usersList = useUsersList();

            await flushAll();

            usersList.next();

            expect(usersList.hasNextPage.value).toBe(false);
            expect(usersList.page.value).toBe(1);
        });

        it('advances one page for repeated calls before the next request starts', async () => {
            fake.queueResponse(firstOfTwoPages());
            fake.queueResponse(IN_FLIGHT);

            const usersList = useUsersList();

            await flushAll();

            usersList.next();
            usersList.next();
            await flushAll();

            expect(usersList.page.value).toBe(2);
            expect(fake.calls).toHaveLength(2);
        });

        it('does not advance again while the next page is in flight', async () => {
            fake.queueResponse(firstOfTwoPages());
            fake.queueResponse(IN_FLIGHT);

            const usersList = useUsersList();

            await flushAll();

            usersList.next();
            await flushAll();

            expect(usersList.isLoading.value).toBe(true);
            expect(usersList.hasNextPage.value).toBe(false);

            usersList.next();
            await flushAll();

            expect(usersList.page.value).toBe(2);
            expect(fake.calls).toHaveLength(2);
        });

        it('does not advance on a page whose refreshed query has not settled', async () => {
            fake.queueResponse(firstOfTwoPages());
            fake.queueResponse(IN_FLIGHT);

            const usersList = useUsersList();

            await flushAll();

            usersList.search('alice');
            usersList.next();

            expect(usersList.page.value).toBe(1);
        });

        it('clamps previous at page 1', async () => {
            fake.queueResponse({ data: [] });

            const usersList = useUsersList();

            await flushAll();

            usersList.previous();

            expect(usersList.page.value).toBe(1);
        });
    });

    describe('wire query', () => {
        /**
         * The query parameters each request was sent with.
         */
        function sentQueries(): unknown[] {
            return fake.calls.map(call => call.options?.query);
        }

        it('requests the first page newest first', async () => {
            fake.queueResponse(firstOfTwoPages());

            useUsersList();
            await flushAll();

            expect(fake.calls[0]?.path).toBe('users');
            expect(sentQueries()).toEqual([{ order: 'created_at:desc', page: 1, limit: 25 }]);
        });

        it('sends the sort, search and page the screen asks for', async () => {
            fake.queueResponse(firstOfTwoPages());
            fake.queueResponse(firstOfTwoPages());
            fake.queueResponse(firstOfTwoPages());
            fake.queueResponse(firstOfTwoPages());

            const usersList = useUsersList();

            await flushAll();
            usersList.sortBy('full_name');
            await flushAll();
            usersList.search('ali');
            await flushAll();
            usersList.next();
            await flushAll();

            expect(sentQueries().slice(1)).toEqual([
                { order: 'full_name', page: 1, limit: 25 },
                { search: 'ali', order: 'full_name', page: 1, limit: 25 },
                { search: 'ali', order: 'full_name', page: 2, limit: 25 },
            ]);
        });

        it('aborts a request superseded by a newer query', async () => {
            fake.queueResponse(IN_FLIGHT);
            fake.queueResponse(IN_FLIGHT);

            const usersList = useUsersList();

            usersList.search('ali');
            await flushAll();

            expect(fake.calls.map(call => call.options?.signal?.aborted)).toEqual([true, false]);
        });

        it('aborts the in-flight request when its scope stops', () => {
            fake.queueResponse(IN_FLIGHT);

            const scope = effectScope();

            scope.run(() => useUsersList());
            scope.stop();

            expect(fake.calls[0]?.options?.signal?.aborted).toBe(true);
        });
    });

    describe('error handling', () => {
        it('surfaces a fetch failure as error and clears it on a successful refetch', async () => {
            fake.queueError(new Error('network down'));

            const usersList = useUsersList();

            await flushAll();

            expect(usersList.error.value).toBeInstanceOf(Error);
            expect(usersList.rows.value).toEqual([]);

            fake.queueResponse({ data: [userRow('u1', 'Alice Smith')] });

            await usersList.refetch();

            expect(usersList.error.value).toBeNull();
            expect(usersList.rows.value).toHaveLength(1);
        });
    });
});
