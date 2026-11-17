/**
 * Unit tests for navigation-progress.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it, vi } from 'vitest';
import type { Component } from 'vue';
import { defineComponent, effectScope } from 'vue';
import type { Router } from 'vue-router';
import { createMemoryHistory, createRouter } from 'vue-router';

import { createNavigationProgress, type NavigationProgress } from './navigation-progress';

const EmptyComponent = defineComponent({ render: () => null });

/**
 * A lazy route component whose load the test settles on demand.
 */
interface DeferredComponent {
    /** The lazy loader the route registers. */
    readonly load: () => Promise<Component>;

    /** Settle the pending load with an empty component. */
    readonly resolve: () => void;
}

/** Build a lazy route component whose load the test settles on demand. */
function deferredComponent(): DeferredComponent {
    let resolve!: () => void;
    const promise = new Promise<Component>(res => {
        resolve = () => res(EmptyComponent);
    });

    return { load: () => promise, resolve };
}

/** Build a memory router with an eager, a lazy and a failing route. */
function buildRouter(lazyLoader: () => Promise<Component>): Router {
    return createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', component: EmptyComponent },
            { path: '/lazy', component: lazyLoader },
            { path: '/broken', component: () => Promise.reject(new Error('exploded loading the route')) },
        ],
    });
}

/** Flush the microtask queue built up by the router's async guard pipeline. */
async function flushRouterGuards(): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
}

describe('createNavigationProgress', () => {
    it('starts with isNavigating false and no warning outside an effect scope', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const router = buildRouter(() => Promise.resolve(EmptyComponent));
        const progress = createNavigationProgress(router);

        expect(progress.isNavigating.value).toBe(false);
        expect(warn).not.toHaveBeenCalled();

        progress.stop();
        warn.mockRestore();
    });

    it('sets isNavigating true while a lazy navigation is in flight and false once it completes', async () => {
        const deferred = deferredComponent();
        const router = buildRouter(deferred.load);
        const progress = createNavigationProgress(router);

        const navigation = router.push('/lazy');

        await flushRouterGuards();
        expect(progress.isNavigating.value).toBe(true);

        deferred.resolve();
        await navigation;

        expect(progress.isNavigating.value).toBe(false);

        progress.stop();
    });

    it('sets isNavigating false after a navigation error', async () => {
        const router = buildRouter(() => Promise.resolve(EmptyComponent));
        const progress = createNavigationProgress(router);

        await router.push('/broken').catch(() => {
            // The push rejects too; only the onError handler is under test.
        });

        expect(progress.isNavigating.value).toBe(false);

        progress.stop();
    });

    it('stop() resets isNavigating mid-navigation', async () => {
        const deferred = deferredComponent();
        const router = buildRouter(deferred.load);
        const progress = createNavigationProgress(router);

        const navigation = router.push('/lazy');

        await flushRouterGuards();
        expect(progress.isNavigating.value).toBe(true);

        progress.stop();
        expect(progress.isNavigating.value).toBe(false);

        deferred.resolve();
        await navigation;

        expect(progress.isNavigating.value).toBe(false);
    });

    it('stop() stops tracking later navigations', async () => {
        const deferred = deferredComponent();
        const router = buildRouter(deferred.load);
        const progress = createNavigationProgress(router);

        progress.stop();

        const navigation = router.push('/lazy');

        await flushRouterGuards();
        expect(progress.isNavigating.value).toBe(false);

        deferred.resolve();
        await navigation;

        expect(progress.isNavigating.value).toBe(false);
    });

    it('resets isNavigating when the enclosing effect scope is disposed', async () => {
        const deferred = deferredComponent();
        const router = buildRouter(deferred.load);
        const scope = effectScope();
        let progress!: NavigationProgress;

        scope.run(() => {
            progress = createNavigationProgress(router);
        });

        const navigation = router.push('/lazy');

        await flushRouterGuards();
        expect(progress.isNavigating.value).toBe(true);

        scope.stop();

        expect(progress.isNavigating.value).toBe(false);

        deferred.resolve();
        await navigation;
    });

    it('stays navigating while a newer navigation is in flight after a superseded one settles', async () => {
        const first = deferredComponent();
        const second = deferredComponent();
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', component: EmptyComponent },
                { path: '/first', component: first.load },
                { path: '/second', component: second.load },
            ],
        });
        const progress = createNavigationProgress(router);

        const superseded = router.push('/first');

        await flushRouterGuards();

        const latest = router.push('/second');

        await flushRouterGuards();
        first.resolve();
        await superseded;

        expect(progress.isNavigating.value).toBe(true);

        second.resolve();
        await latest;

        expect(progress.isNavigating.value).toBe(false);

        progress.stop();
    });

    it('stays navigating when a superseded navigation fails while a newer one is in flight', async () => {
        let failFirst!: (error: Error) => void;
        const second = deferredComponent();
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', component: EmptyComponent },
                { path: '/first', component: () => new Promise<Component>((_resolve, reject) => (failFirst = reject)) },
                { path: '/second', component: second.load },
            ],
        });
        const progress = createNavigationProgress(router);

        const superseded = router.push('/first').catch(() => undefined);

        await flushRouterGuards();

        const latest = router.push('/second');

        await flushRouterGuards();
        failFirst(new Error('chunk failed'));
        await superseded;

        expect(progress.isNavigating.value).toBe(true);

        second.resolve();
        await latest;

        expect(progress.isNavigating.value).toBe(false);

        progress.stop();
    });

    it('settles when a guard redirects to the current location', async () => {
        const router = buildRouter(() => Promise.resolve(EmptyComponent));
        const progress = createNavigationProgress(router);

        await router.push('/');
        router.beforeEach(to => (to.path === '/lazy' ? '/' : true));
        await router.push('/lazy');

        expect(router.currentRoute.value.path).toBe('/');
        expect(progress.isNavigating.value).toBe(false);

        progress.stop();
    });

    it('settles when the current location is pushed while a navigation is pending', async () => {
        const pending = deferredComponent();
        const router = buildRouter(pending.load);
        const progress = createNavigationProgress(router);

        await router.push('/');

        const superseded = router.push('/lazy');

        await flushRouterGuards();
        await router.push('/');

        expect(progress.isNavigating.value).toBe(false);

        pending.resolve();
        await superseded;

        expect(progress.isNavigating.value).toBe(false);

        progress.stop();
    });
});
