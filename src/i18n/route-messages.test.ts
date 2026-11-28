/**
 * Unit tests for route-messages.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import type { RouteLocationNormalized, RouteRecordRaw, Router } from 'vue-router';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { ModuleDefinition } from '../module/module';
import { createApplicationRouter } from '../router/router-factory';
import type { ModuleMessageLoader } from './application-i18n';
import { RouteMessages, ownedModuleRoutes, routeOwners } from './route-messages';

const Page = defineComponent({ render: () => null });

/**
 * Build a module contributing the given routes.
 */
function module(name: string, routes: RouteRecordRaw[]): ModuleDefinition {
    return { name, routes };
}

const MODULES = [
    module('users', [
        {
            path: '/users',
            component: Page,
            meta: { title: 'users.title' },
            children: [{ path: ':id', component: Page }],
        },
    ]),
    module('home', [{ path: '/', alias: '/start', component: Page }]),
];

/** One request a loader received. */
interface LoaderCall {
    /** The modules requested. */
    readonly modules: readonly string[];

    /** The request's interest signal. */
    readonly signal: AbortSignal | undefined;
}

/** A loader whose loads the test settles. */
interface PendingLoader extends ModuleMessageLoader {
    /** Each request received. */
    readonly calls: LoaderCall[];

    /**
     * Settle the latest load.
     */
    settle(error?: Error): void;
}

/**
 * Build a module message loader whose loads the test settles.
 */
function pendingLoader(): PendingLoader {
    const calls: LoaderCall[] = [];

    /**
     * Settle the latest load; replaced by each new load.
     */
    let settleLatest = (_error?: Error): void => undefined;

    return {
        calls,
        loadModules(modules, signal) {
            calls.push({ modules, signal });

            return new Promise<void>((resolve, reject) => {
                settleLatest = (error?: Error): void => {
                    if (error === undefined) {
                        resolve();
                    } else {
                        reject(error);
                    }
                };
            });
        },
        settle: error => {
            settleLatest(error);
        },
    };
}

/** A router after-each hook, loosely typed for driving it directly. */
type AfterHook = (to: unknown, from: unknown, failure: unknown) => void;

/** The hooks a stub router captured. */
interface CapturedHooks {
    /** The after-each hook, once installed. */
    after?: AfterHook;
}

/**
 * Build an application router whose navigations load route messages.
 */
function routed(loader: ModuleMessageLoader) {
    const messages = new RouteMessages(loader);
    const router = createApplicationRouter({
        routes: ownedModuleRoutes(MODULES),
        history: createMemoryHistory(),
        onNavigationStart: messages.start,
    });
    const uninstall = messages.install(router);

    return { router, uninstall };
}

describe('ownedModuleRoutes', () => {
    it('marks each record and child with its module, keeping its own meta', () => {
        const router = createRouter({ history: createMemoryHistory(), routes: ownedModuleRoutes(MODULES) });
        const users = router.resolve('/users/7');

        expect(routeOwners(users.matched)).toEqual(['users']);
        expect(users.matched[0]?.meta.title).toBe('users.title');
        expect(routeOwners(router.resolve('/start').matched)).toEqual(['home']);
    });

    it('leaves the module definitions untouched', () => {
        ownedModuleRoutes(MODULES);

        expect(Object.getOwnPropertySymbols(MODULES[0]?.routes[0]?.meta ?? {})).toEqual([]);
    });
});

describe('routeOwners', () => {
    it('ignores records no module owns', () => {
        const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: Page }] });

        expect(routeOwners(router.resolve('/').matched)).toEqual([]);
    });
});

describe('RouteMessages', () => {
    it('holds a navigation until its modules’ messages load', async () => {
        const loader = pendingLoader();
        const { router } = routed(loader);
        const navigation = router.push('/users/7');

        await vi.waitFor(() => {
            expect(loader.calls.at(-1)?.modules).toEqual(['users']);
        });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(router.currentRoute.value.path).not.toBe('/users/7');

        loader.settle();
        await navigation;

        expect(router.currentRoute.value.path).toBe('/users/7');
    });

    it('fails a navigation with the error its messages failed to load with', async () => {
        const loader = pendingLoader();
        const failure = new Error('Failed to fetch dynamically imported module: /assets/users.js');
        const { router } = routed(loader);
        const onError = vi.fn();

        router.onError(onError);

        const navigation = router.push('/users').catch((error: unknown) => error);

        await vi.waitFor(() => {
            expect(loader.calls).toHaveLength(1);
        });
        loader.settle(failure);

        expect(await navigation).toBe(failure);
        expect(onError).toHaveBeenCalledWith(failure, expect.anything(), expect.anything());
    });

    it('releases a navigation’s interest when another supersedes it', async () => {
        const loader = pendingLoader();
        const { router } = routed(loader);

        void router.push('/users').catch(() => undefined);
        await vi.waitFor(() => {
            expect(loader.calls).toHaveLength(1);
        });

        const second = router.push('/');

        await vi.waitFor(() => {
            expect(loader.calls[0]?.signal?.aborted).toBe(true);
        });

        loader.settle();
        await second;
    });

    it('releases a navigation’s interest once it ends', async () => {
        const signals: (AbortSignal | undefined)[] = [];
        const { router } = routed({
            loadModules(_modules, signal) {
                signals.push(signal);

                return Promise.resolve();
            },
        });

        await router.push('/users');

        expect(signals.at(-1)?.aborted).toBe(true);
    });

    it('releases a navigation’s interest when it fails', async () => {
        const signals: (AbortSignal | undefined)[] = [];
        const messages = new RouteMessages({
            loadModules(_modules, signal) {
                signals.push(signal);

                return new Promise<void>(() => undefined);
            },
        });
        const router = createApplicationRouter({
            routes: ownedModuleRoutes(MODULES),
            history: createMemoryHistory(),
            globalMiddleware: [
                {
                    handle: () => {
                        throw new Error('middleware failed');
                    },
                },
            ],
            onNavigationStart: messages.start,
        });

        messages.install(router);

        await expect(router.push('/users')).rejects.toThrow('middleware failed');
        expect(signals.at(-1)?.aborted).toBe(true);
    });

    it('releases a pending navigation’s interest when a duplicate of the current route cancels it', async () => {
        const loader = pendingLoader();
        const { router } = routed(loader);

        const start = router.push('/');

        await vi.waitFor(() => {
            expect(loader.calls).toHaveLength(1);
        });
        loader.settle();
        await start;

        void router.push('/users').catch(() => undefined);
        await vi.waitFor(() => {
            expect(loader.calls).toHaveLength(2);
        });

        await router.push('/');

        expect(loader.calls[1]?.signal?.aborted).toBe(true);
    });

    it('keeps the latest navigation’s interest when an older one cancelled before its guards ends', async () => {
        const failures = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', component: Page },
                { path: '/a', component: Page },
            ],
        });

        await failures.push('/');

        const cancelled = failures.push('/a');
        const duplicated = await failures.push('/');
        const loader = pendingLoader();
        const messages = new RouteMessages(loader);
        const hooks: CapturedHooks = {};
        const router = {
            beforeResolve: () => () => undefined,
            afterEach: (hook: AfterHook) => {
                hooks.after = hook;

                return () => undefined;
            },
            onError: () => () => undefined,
        } as unknown as Router;

        messages.install(router);
        messages.start(failures.resolve('/a') as RouteLocationNormalized);
        hooks.after?.(failures.resolve('/'), failures.currentRoute.value, await cancelled);

        expect(loader.calls[0]?.signal?.aborted).toBe(false);

        hooks.after?.(failures.resolve('/'), failures.currentRoute.value, duplicated);

        expect(loader.calls[0]?.signal?.aborted).toBe(true);
    });

    it('stops holding and releasing navigations once uninstalled', async () => {
        const loader = pendingLoader();
        const { router, uninstall } = routed(loader);

        uninstall();
        await router.push('/users');

        expect(router.currentRoute.value.path).toBe('/users');
        expect(loader.calls.at(-1)?.signal?.aborted).toBe(false);
    });

    it('stops releasing failed navigations once uninstalled', async () => {
        const signals: (AbortSignal | undefined)[] = [];
        const messages = new RouteMessages({
            loadModules(_modules, signal) {
                signals.push(signal);

                return Promise.resolve();
            },
        });
        const router = createApplicationRouter({
            routes: ownedModuleRoutes(MODULES),
            history: createMemoryHistory(),
            globalMiddleware: [{ handle: () => Promise.reject(new Error('middleware failed')) }],
            onNavigationStart: messages.start,
        });

        messages.install(router)();

        await expect(router.push('/users')).rejects.toThrow('middleware failed');
        expect(signals.at(-1)?.aborted).toBe(false);
    });

    it('observes the failed load of a navigation that never reaches its messages', async () => {
        const unhandled = vi.fn();
        const loader = pendingLoader();
        const messages = new RouteMessages(loader);
        const router = createApplicationRouter({
            routes: ownedModuleRoutes(MODULES),
            history: createMemoryHistory(),
            globalMiddleware: [{ handle: () => Promise.reject(new Error('middleware failed')) }],
            onNavigationStart: messages.start,
        });

        messages.install(router);
        process.on('unhandledRejection', unhandled);

        try {
            const navigation = router.push('/users').catch(() => undefined);

            await vi.waitFor(() => {
                expect(loader.calls).toHaveLength(1);
            });
            await navigation;
            loader.settle(new Error('offline'));
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });
});
