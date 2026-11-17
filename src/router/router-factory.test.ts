/**
 * Unit tests for router-factory.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import type { RouteLocationNormalized, RouteLocationNormalizedLoaded } from 'vue-router';
import { createMemoryHistory } from 'vue-router';

import type { RouteMiddleware } from './middleware';
import { next, redirect } from '@sinemacula/foundation/router/middleware';
import { createNavigationProgress } from './navigation-progress';
import { RedirectLoopError } from './redirect-loop-error';
import { createApplicationRouter, resolveScrollPosition } from './router-factory';

const EmptyComponent = defineComponent({ render: () => null });

describe('resolveScrollPosition', () => {
    it('returns the saved position when one is provided', () => {
        const saved = { left: 10, top: 20 };
        const to = { hash: '' } as unknown as RouteLocationNormalized;

        const result = resolveScrollPosition(to, {} as RouteLocationNormalizedLoaded, saved);

        expect(result).toStrictEqual(saved);
    });

    it('returns a hash anchor target when no saved position and hash is present', () => {
        const to = { hash: '#section' } as unknown as RouteLocationNormalized;

        const result = resolveScrollPosition(to, {} as RouteLocationNormalizedLoaded, null);

        expect(result).toStrictEqual({ el: '#section' });
    });

    it('returns top-left zero when no saved position and no hash', () => {
        const to = { hash: '' } as unknown as RouteLocationNormalized;

        const result = resolveScrollPosition(to, {} as RouteLocationNormalizedLoaded, null);

        expect(result).toStrictEqual({ top: 0, left: 0 });
    });
});

describe('createApplicationRouter', () => {
    it('uses the provided history instead of web history', () => {
        const history = createMemoryHistory();

        const router = createApplicationRouter({ routes: [], history });

        expect(router.options.history).toBe(history);
    });

    it('uses createWebHistory when no history override is provided', () => {
        const router = createApplicationRouter({ routes: [] });

        expect(router.options.history).toBeDefined();
    });

    it('registers the given routes on the router', () => {
        const router = createApplicationRouter({
            history: createMemoryHistory(),
            routes: [{ path: '/home', component: EmptyComponent }],
        });

        const found = router.getRoutes().find(route => route.path === '/home');

        expect(found).toBeDefined();
    });

    it('navigates normally when a route has no middleware', async () => {
        const router = createApplicationRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', component: EmptyComponent },
                { path: '/about', component: EmptyComponent },
            ],
        });

        await router.push('/about');

        expect(router.currentRoute.value.path).toBe('/about');
    });

    it('allows navigation when middleware returns next', async () => {
        const passingMiddleware: RouteMiddleware = { handle: async () => next() };
        const router = createApplicationRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', component: EmptyComponent },
                { path: '/protected', component: EmptyComponent, meta: { middleware: [passingMiddleware] } },
            ],
        });

        await router.push('/protected');

        expect(router.currentRoute.value.path).toBe('/protected');
    });

    it('redirects navigation when middleware returns redirect', async () => {
        const redirectingMiddleware: RouteMiddleware = { handle: async () => redirect('/') };
        const router = createApplicationRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', component: EmptyComponent },
                { path: '/guarded', component: EmptyComponent, meta: { middleware: [redirectingMiddleware] } },
            ],
        });

        await router.push('/guarded');

        expect(router.currentRoute.value.path).toBe('/');
    });

    it('runs global middleware before matched-record meta middleware', async () => {
        const order: string[] = [];

        /**
         * Build a middleware that records its name when it runs.
         */
        const recording = (name: string): RouteMiddleware => ({
            handle: () => {
                order.push(name);

                return Promise.resolve(next());
            },
        });

        const router = createApplicationRouter({
            history: createMemoryHistory(),
            globalMiddleware: [recording('global-one'), recording('global-two')],
            routes: [
                { path: '/', component: EmptyComponent },
                { path: '/ordered', component: EmptyComponent, meta: { middleware: [recording('meta')] } },
            ],
        });

        await router.push('/ordered');

        expect(order).toStrictEqual(['global-one', 'global-two', 'meta']);
        expect(router.currentRoute.value.path).toBe('/ordered');
    });

    it('short-circuits later global and meta middleware when a global middleware redirects', async () => {
        const secondGlobalHandle = vi.fn(async () => next());
        const metaHandle = vi.fn(async () => next());
        const redirectingGlobal: RouteMiddleware = {
            handle: async context => (context.to.path === '/guarded' ? redirect('/safe') : next()),
        };
        const router = createApplicationRouter({
            history: createMemoryHistory(),
            globalMiddleware: [redirectingGlobal, { handle: secondGlobalHandle }],
            routes: [
                { path: '/', component: EmptyComponent },
                { path: '/safe', component: EmptyComponent },
                { path: '/guarded', component: EmptyComponent, meta: { middleware: [{ handle: metaHandle }] } },
            ],
        });

        await router.push('/guarded');

        expect(router.currentRoute.value.path).toBe('/safe');
        expect(metaHandle).not.toHaveBeenCalled();
        expect(secondGlobalHandle).toHaveBeenCalledTimes(1);
    });

    it('runs global middleware on navigations to routes that declare no middleware', async () => {
        const globalHandle = vi.fn(async () => next());
        const router = createApplicationRouter({
            history: createMemoryHistory(),
            globalMiddleware: [{ handle: globalHandle }],
            routes: [
                { path: '/', component: EmptyComponent },
                { path: '/plain', component: EmptyComponent },
            ],
        });

        await router.push('/plain');
        await router.push('/');

        expect(globalHandle).toHaveBeenCalledTimes(2);
    });

    it('runs matched-record middleware parent-first after global middleware', async () => {
        const order: string[] = [];

        /**
         * Build a middleware that records its name when it runs.
         */
        const recording = (name: string): RouteMiddleware => ({
            handle: () => {
                order.push(name);

                return Promise.resolve(next());
            },
        });

        const router = createApplicationRouter({
            history: createMemoryHistory(),
            globalMiddleware: [recording('global')],
            routes: [
                { path: '/', component: EmptyComponent },
                {
                    path: '/parent',
                    component: EmptyComponent,
                    meta: { middleware: [recording('parent')] },
                    children: [
                        { path: 'child', component: EmptyComponent, meta: { middleware: [recording('child')] } },
                    ],
                },
            ],
        });

        await router.push('/parent/child');

        expect(order).toStrictEqual(['global', 'parent', 'child']);
    });

    it('rejects with the middleware error, skips later middleware and notifies error listeners', async () => {
        const failure = new Error('refresh failed');
        const laterHandle = vi.fn(async () => next());
        const onError = vi.fn();
        const router = createApplicationRouter({
            history: createMemoryHistory(),
            globalMiddleware: [{ handle: () => Promise.reject(failure) }, { handle: laterHandle }],
            routes: [{ path: '/', component: EmptyComponent }],
        });

        router.onError(onError);

        const ready = router.isReady();

        await expect(router.push('/')).rejects.toBe(failure);
        await expect(ready).rejects.toBe(failure);
        expect(laterHandle).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(failure, expect.objectContaining({ path: '/' }), expect.anything());
    });

    describe('redirect loops', () => {
        /**
         * Build a middleware that redirects through `redirectFor` but gives up
         * after fifty calls, so a missing loop guard fails the test instead of
         * hanging it.
         */
        function boundedRedirects(redirectFor: (path: string) => string | null): RouteMiddleware {
            let calls = 0;

            return {
                handle: ({ to }) => {
                    calls += 1;

                    const target = calls > 50 ? null : redirectFor(to.path);

                    return Promise.resolve(target === null ? next() : redirect(target));
                },
            };
        }

        /** Build a router whose middleware redirects `/ping` and `/pong` to each other. */
        function pingPongRouter() {
            const router = createApplicationRouter({
                history: createMemoryHistory(),
                globalMiddleware: [
                    boundedRedirects(path => {
                        if (path === '/ping') {
                            return '/pong';
                        }

                        return path === '/pong' ? '/ping' : null;
                    }),
                ],
                routes: [
                    { path: '/', component: EmptyComponent },
                    { path: '/ping', component: EmptyComponent },
                    { path: '/pong', component: EmptyComponent },
                ],
            });

            router.onError(() => undefined);

            return router;
        }

        it('fails a navigation whose middleware redirect to each other', async () => {
            const router = pingPongRouter();

            await router.push('/');

            const failure = await router.push('/ping').catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(RedirectLoopError);
            expect(failure).toMatchObject({
                name: 'RedirectLoopError',
                message: 'Navigation to "/ping" exceeded 10 middleware redirects; the next was to "/pong".',
                origin: '/ping',
                target: '/pong',
                limit: 10,
            });
            expect(router.currentRoute.value.path).toBe('/');
        });

        it('fails a middleware redirect back to the same location', async () => {
            const router = createApplicationRouter({
                history: createMemoryHistory(),
                globalMiddleware: [boundedRedirects(path => (path === '/self' ? '/self?again=1' : null))],
                routes: [
                    { path: '/', component: EmptyComponent },
                    { path: '/self', component: EmptyComponent },
                ],
            });

            router.onError(() => undefined);

            await expect(router.push('/self')).rejects.toBeInstanceOf(RedirectLoopError);
        });

        it('reports the loop to error listeners and resets navigation progress', async () => {
            const router = pingPongRouter();
            const onError = vi.fn();

            await router.push('/');
            router.onError(onError);

            const progress = createNavigationProgress(router);

            await router.push('/ping').catch(() => undefined);

            expect(onError).toHaveBeenCalledWith(expect.any(RedirectLoopError), expect.anything(), expect.anything());
            expect(progress.isNavigating.value).toBe(false);

            progress.stop();
        });

        it('allows a chain of ten middleware redirects', async () => {
            const router = createApplicationRouter({
                history: createMemoryHistory(),
                globalMiddleware: [
                    {
                        handle: ({ to }) => {
                            const step = Number(to.params['step']);

                            return Promise.resolve(step < 10 ? redirect(`/step/${step + 1}`) : next());
                        },
                    },
                ],
                routes: [
                    { path: '/', component: EmptyComponent },
                    { path: '/step/:step', component: EmptyComponent },
                ],
            });

            await router.push('/step/0');

            expect(router.currentRoute.value.path).toBe('/step/10');
        });

        it('counts redirects per navigation, not across navigations', async () => {
            const router = createApplicationRouter({
                history: createMemoryHistory(),
                globalMiddleware: [{ handle: async ({ to }) => (to.path === '/old' ? redirect('/new') : next()) }],
                routes: [
                    { path: '/', component: EmptyComponent },
                    { path: '/old', component: EmptyComponent },
                    { path: '/new', component: EmptyComponent },
                ],
            });

            for (let attempt = 0; attempt < 12; attempt += 1) {
                await router.push('/');
                await router.push('/old');
            }

            expect(router.currentRoute.value.path).toBe('/new');
        });
    });
});
