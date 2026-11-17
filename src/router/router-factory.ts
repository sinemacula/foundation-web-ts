/**
 * Application router factory with the middleware pipeline as a global guard.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type {
    RouteLocation,
    RouteLocationNormalized,
    RouteRecordRaw,
    Router,
    RouterHistory,
    RouterScrollBehavior,
} from 'vue-router';
import { createRouter, createWebHistory } from 'vue-router';

import type { RouteMiddleware } from './middleware';
import { RedirectLoopError } from './redirect-loop-error';
import { runMiddlewarePipeline } from '@sinemacula/foundation/router/middleware';

const MAX_MIDDLEWARE_REDIRECTS = 10;

/**
 * Options for building the application router.
 */
export interface RouterFactoryOptions {
    /** The routes to install on the router. */
    readonly routes: readonly RouteRecordRaw[];

    /** The history implementation; defaults to HTML5 history. */
    readonly history?: RouterHistory;

    /** Middleware run on every navigation before matched-record meta middleware. */
    readonly globalMiddleware?: readonly RouteMiddleware[];
}

/**
 * Build the application router, running global middleware before the middleware
 * declared on the matched records; a navigation redirected by middleware more
 * than ten times fails with a {@link RedirectLoopError} through the router's
 * error flow.
 */
export function createApplicationRouter(options: RouterFactoryOptions): Router {
    const globalMiddleware = options.globalMiddleware ?? [];
    const redirectCounts = new WeakMap<RouteLocation | RouteLocationNormalized, number>();

    const router = createRouter({
        history: options.history ?? createWebHistory(),
        routes: [...options.routes],
        scrollBehavior: resolveScrollPosition,
    });

    router.beforeEach(async (to, from) => {
        const result = await runMiddlewarePipeline([...globalMiddleware, ...collectRouteMiddleware(to)], { to, from });

        if (result.kind !== 'redirect') {
            return true;
        }

        const origin = to.redirectedFrom ?? to;
        const redirects = (redirectCounts.get(origin) ?? 0) + 1;

        if (redirects > MAX_MIDDLEWARE_REDIRECTS) {
            throw new RedirectLoopError(origin.fullPath, router.resolve(result.to).fullPath, MAX_MIDDLEWARE_REDIRECTS);
        }

        redirectCounts.set(origin, redirects);

        return result.to;
    });

    return router;
}

/**
 * Gather the middleware declared by every matched route record, parent-first.
 */
function collectRouteMiddleware(to: RouteLocationNormalized) {
    return to.matched.flatMap(record => record.meta.middleware ?? []);
}

/**
 * Restore the saved scroll position, else scroll to the hash anchor, else to
 * the top.
 */
export const resolveScrollPosition: RouterScrollBehavior = (to, _from, savedPosition) => {
    if (savedPosition !== null) {
        return savedPosition;
    }

    if (to.hash !== '') {
        return { el: to.hash };
    }

    return { top: 0, left: 0 };
};
