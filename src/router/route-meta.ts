/**
 * Application-wide shape of vue-router's `route.meta`.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { RouteMiddleware } from './middleware';

declare module 'vue-router' {
    interface RouteMeta {
        /** Translation key for the document title. */
        title?: string;

        /** Middleware evaluated, in order, before the route is entered. */
        middleware?: readonly RouteMiddleware[];
    }
}
