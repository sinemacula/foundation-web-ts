/**
 * Loading each module's messages with its routes.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { RouteLocationNormalized, RouteRecordNormalized, RouteRecordRaw, Router } from 'vue-router';
import { NavigationFailureType, isNavigationFailure } from 'vue-router';

import type { ModuleDefinition } from '../module/module';
import type { ModuleMessageLoader } from './application-i18n';

/** The route meta key naming the module that owns a route record. */
const MODULE_OWNER = Symbol('module-owner');

/**
 * Every module's routes in registry order, each record and child marked with
 * the module that owns it.
 */
export function ownedModuleRoutes(modules: readonly ModuleDefinition[]): RouteRecordRaw[] {
    return modules.flatMap(definition => definition.routes.map(route => ownRoute(route, definition.name)));
}

/**
 * The modules owning the matched records, parent first, without repeats.
 */
export function routeOwners(matched: readonly RouteRecordNormalized[]): string[] {
    const owners = matched.map(record => record.meta[MODULE_OWNER]);

    return [...new Set(owners.filter(owner => typeof owner === 'string'))];
}

/**
 * Loads each navigation's route modules' messages alongside its components,
 * holding the navigation until both load.
 */
export class RouteMessages {
    /** Loads the modules' messages. */
    readonly #loader: ModuleMessageLoader;

    /** Each navigation's messages load. */
    readonly #loads = new WeakMap<RouteLocationNormalized, Promise<void>>();

    /** Each navigation's interest in its modules, released once it ends. */
    readonly #interests = new WeakMap<RouteLocationNormalized, AbortController>();

    /** The latest navigation's interest, released when another starts. */
    #latest: AbortController | null = null;

    constructor(loader: ModuleMessageLoader) {
        this.#loader = loader;
    }

    /**
     * Start loading the target's module messages as its navigation starts,
     * releasing the interest of the navigation it supersedes.
     */
    readonly start = (to: RouteLocationNormalized): void => {
        const interest = new AbortController();

        this.#latest?.abort();
        this.#latest = interest;
        this.#interests.set(to, interest);

        const loading = this.#loader.loadModules(routeOwners(to.matched), interest.signal);

        loading.catch(() => undefined);
        this.#loads.set(to, loading);
    };

    /**
     * Hold each navigation until its messages load, and release a navigation's
     * interest once it ends or fails; a duplicate of the current route, which
     * no guard sees, cancels the navigation in flight, so release that.
     */
    install(router: Router): () => void {
        const removeResolveGuard = router.beforeResolve(to => this.#loads.get(to));
        const removeAfterHook = router.afterEach((to, _from, failure) => {
            if (isNavigationFailure(failure, NavigationFailureType.duplicated)) {
                this.#latest?.abort();
            }

            this.#interests.get(to)?.abort();
        });
        const removeErrorHandler = router.onError((_error, to) => {
            this.#interests.get(to)?.abort();
        });

        return () => {
            removeResolveGuard();
            removeAfterHook();
            removeErrorHandler();
        };
    }
}

/**
 * Copy a route record and its children, marking each with its owner.
 */
function ownRoute(route: RouteRecordRaw, owner: string): RouteRecordRaw {
    return {
        ...route,
        meta: { ...route.meta, [MODULE_OWNER]: owner },
        ...(route.children === undefined ? {} : { children: route.children.map(child => ownRoute(child, owner)) }),
    } as RouteRecordRaw;
}
