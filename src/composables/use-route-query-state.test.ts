/**
 * Unit tests for use-route-query-state.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { useRouteQueryState } from './use-route-query-state';

const EmptyComponent = defineComponent({ render: () => null });

/** Build a memory router and the URL that carries the given initial query. */
function makeRouter(initialQuery: Record<string, string> = {}) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/', component: EmptyComponent }],
    });

    const qs = new URLSearchParams(initialQuery).toString();
    const url = qs.length > 0 ? `/?${qs}` : '/';

    return { router, url };
}

describe('useRouteQueryState', () => {
    describe('values', () => {
        it('returns defaults when the URL has no query params', async () => {
            const { router, url } = makeRouter();
            await router.push(url);

            const state = useRouteQueryState(router, { defaults: { page: '1', sort: 'name' } });

            expect(state.values.value).toStrictEqual({ page: '1', sort: 'name' });
        });

        it('overlays actual query values over defaults', async () => {
            const { router, url } = makeRouter({ page: '3' });
            await router.push(url);

            const state = useRouteQueryState(router, { defaults: { page: '1', sort: 'name' } });

            expect(state.values.value).toStrictEqual({ page: '3', sort: 'name' });
        });

        it('does not include foreign (unmanaged) query keys in values', async () => {
            const { router, url } = makeRouter({ page: '2', extra: 'ignored' });
            await router.push(url);

            const state = useRouteQueryState(router, { defaults: { page: '1' } });

            expect(state.values.value).toStrictEqual({ page: '2' });
            expect('extra' in state.values.value).toBe(false);
        });

        it('uses the first element when the query value is an array', async () => {
            const router = createRouter({
                history: createMemoryHistory(),
                routes: [{ path: '/', component: EmptyComponent }],
            });
            await router.push({ path: '/', query: { tag: ['alpha', 'beta'] } });

            const state = useRouteQueryState(router, { defaults: { tag: 'all' } });

            expect(state.values.value['tag']).toBe('alpha');
        });

        it('falls back to the default when the array is empty-like (all null elements)', async () => {
            const router = createRouter({
                history: createMemoryHistory(),
                routes: [{ path: '/', component: EmptyComponent }],
            });
            await router.push({ path: '/', query: { tag: [null] } });

            const state = useRouteQueryState(router, { defaults: { tag: 'all' } });

            expect(state.values.value['tag']).toBe('all');
        });

        it('keeps multi-character values intact', async () => {
            const { router, url } = makeRouter({ sort: 'created_at', page: '12' });
            await router.push(url);

            const state = useRouteQueryState(router, { defaults: { page: '1', sort: 'name' } });

            expect(state.values.value).toStrictEqual({ page: '12', sort: 'created_at' });
        });

        it('falls back to the default for a bare key without a value', async () => {
            const { router } = makeRouter();
            await router.push('/?page');

            const state = useRouteQueryState(router, { defaults: { page: '1' } });

            expect(state.values.value).toStrictEqual({ page: '1' });
        });

        it('falls back to the default for an empty array', async () => {
            const { router } = makeRouter();
            await router.push({ path: '/', query: { tag: [] } });

            const state = useRouteQueryState(router, { defaults: { tag: 'all' } });

            expect(state.values.value).toStrictEqual({ tag: 'all' });
        });

        it('reacts to route changes', async () => {
            const { router, url } = makeRouter({ page: '1' });
            await router.push(url);

            const state = useRouteQueryState(router, { defaults: { page: '1' } });

            expect(state.values.value['page']).toBe('1');

            await router.push({ query: { page: '5' } });

            expect(state.values.value['page']).toBe('5');
        });
    });

    describe('get', () => {
        it('returns the resolved value for a managed key', async () => {
            const { router, url } = makeRouter({ page: '7' });
            await router.push(url);

            const state = useRouteQueryState(router, { defaults: { page: '1' } });

            expect(state.get('page')).toBe('7');
        });

        it('returns the default for a managed key absent from the query', async () => {
            const { router, url } = makeRouter();
            await router.push(url);

            const state = useRouteQueryState(router, { defaults: { page: '1' } });

            expect(state.get('page')).toBe('1');
        });

        it('returns empty string for an entirely unknown key', async () => {
            const { router, url } = makeRouter();
            await router.push(url);

            const state = useRouteQueryState(router, { defaults: { page: '1' } });

            expect(state.get('nonexistent')).toBe('');
        });
    });

    describe('set', () => {
        it('updates a managed key in the URL via router.replace', async () => {
            const { router, url } = makeRouter({ page: '1' });
            await router.push(url);

            const state = useRouteQueryState(router, { defaults: { page: '1', sort: 'name' } });

            await state.set({ page: '3' });

            expect(router.currentRoute.value.query['page']).toBe('3');
        });

        it('merges the patch over existing query params', async () => {
            const { router, url } = makeRouter({ page: '2', sort: 'date' });
            await router.push(url);

            const state = useRouteQueryState(router, { defaults: { page: '1', sort: 'name' } });

            await state.set({ page: '4' });

            expect(router.currentRoute.value.query['page']).toBe('4');
            expect(router.currentRoute.value.query['sort']).toBe('date');
        });

        it('removes the key from the URL when set to null', async () => {
            const { router, url } = makeRouter({ page: '3' });
            await router.push(url);

            const state = useRouteQueryState(router, { defaults: { page: '1' } });

            await state.set({ page: null });

            expect(router.currentRoute.value.query['page']).toBeUndefined();
        });

        it('preserves foreign (unmanaged) query parameters', async () => {
            const { router } = makeRouter();
            await router.push({ path: '/', query: { page: '2', foreign: 'kept' } });

            const state = useRouteQueryState(router, { defaults: { page: '1' } });

            await state.set({ page: '3' });

            expect(router.currentRoute.value.query['foreign']).toBe('kept');
            expect(router.currentRoute.value.query['page']).toBe('3');
        });

        it('silently ignores patch keys that are not in defaults', async () => {
            const { router, url } = makeRouter({ page: '1' });
            await router.push(url);

            const state = useRouteQueryState(router, { defaults: { page: '1' } });

            await state.set({ unknown: 'value' });

            expect(router.currentRoute.value.query['unknown']).toBeUndefined();
            expect(router.currentRoute.value.query['page']).toBe('1');
        });

        it('can set multiple keys in a single call', async () => {
            const { router, url } = makeRouter();
            await router.push(url);

            const state = useRouteQueryState(router, { defaults: { page: '1', sort: 'name', dir: 'asc' } });

            await state.set({ page: '2', sort: 'date', dir: 'desc' });

            expect(router.currentRoute.value.query['page']).toBe('2');
            expect(router.currentRoute.value.query['sort']).toBe('date');
            expect(router.currentRoute.value.query['dir']).toBe('desc');
        });
    });

    describe('concurrent set', () => {
        it('applies patches set in the same tick in one navigation', async () => {
            const { router } = makeRouter();
            await router.push('/?a=1');

            const state = useRouteQueryState(router, { defaults: { search: '', page: '1' } });
            let navigations = 0;

            router.afterEach(() => {
                navigations++;
            });

            const search = state.set({ search: 'ada' });
            const page = state.set({ page: '2' });

            await Promise.all([search, page]);

            expect(router.currentRoute.value.query).toStrictEqual({ a: '1', search: 'ada', page: '2' });
            expect(navigations).toBe(1);
        });

        it('lets a later patch in the same tick override an earlier one', async () => {
            const { router } = makeRouter();
            await router.push('/?page=3');

            const state = useRouteQueryState(router, { defaults: { page: '1' } });

            void state.set({ page: '4' });
            await state.set({ page: null });

            expect(router.currentRoute.value.query).toStrictEqual({});
        });

        it('merges patches from separate instances on one router', async () => {
            const { router } = makeRouter();
            await router.push('/');

            const filters = useRouteQueryState(router, { defaults: { search: '' } });
            const tabs = useRouteQueryState(router, { defaults: { tab: 'all' } });

            void filters.set({ search: 'ada', tab: 'ignored' });
            await tabs.set({ tab: 'archived' });

            expect(router.currentRoute.value.query).toStrictEqual({ search: 'ada', tab: 'archived' });
        });

        it('applies a patch set while a navigation is pending on top of it', async () => {
            const { router } = makeRouter();
            await router.push('/');

            const state = useRouteQueryState(router, { defaults: { search: '', page: '1' } });
            let release: () => void = () => undefined;
            const gate = new Promise<void>(resolve => {
                release = resolve;
            });

            const removeGuard = router.beforeEach(() => gate);
            const search = state.set({ search: 'ada' });

            await Promise.resolve();
            await Promise.resolve();

            const page = state.set({ page: '2' });

            removeGuard();
            release();
            await Promise.all([search, page]);

            expect(router.currentRoute.value.query).toStrictEqual({ search: 'ada', page: '2' });
        });

        it('drops a patch a guard cancels and still applies the next one', async () => {
            const { router } = makeRouter();
            await router.push('/?page=1');

            const state = useRouteQueryState(router, { defaults: { page: '1', sort: 'name' } });
            const removeGuard = router.beforeEach(to => to.query['page'] !== '9');

            await expect(state.set({ page: '9' })).resolves.toBeUndefined();
            expect(router.currentRoute.value.query).toStrictEqual({ page: '1' });

            removeGuard();
            await state.set({ sort: 'date' });

            expect(router.currentRoute.value.query).toStrictEqual({ page: '1', sort: 'date' });
        });

        it('rejects the batch a guard throws on without blocking the next one', async () => {
            const { router } = makeRouter();
            await router.push('/');

            const state = useRouteQueryState(router, { defaults: { page: '1' } });
            const failure = new Error('guard failed');
            const removeGuard = router.beforeEach(() => {
                throw failure;
            });

            const failed = state.set({ page: '2' });

            await expect(failed).rejects.toBe(failure);

            removeGuard();
            await state.set({ page: '3' });

            expect(router.currentRoute.value.query).toStrictEqual({ page: '3' });
        });
    });
});
