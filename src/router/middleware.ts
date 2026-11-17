/**
 * Route middleware types bound to vue-router routes and locations.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import './route-meta';

import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router';

import type {
    MiddlewareContext as BaseMiddlewareContext,
    MiddlewareResult as BaseMiddlewareResult,
    RouteMiddleware as BaseRouteMiddleware,
} from '@sinemacula/foundation/router/middleware';

/**
 * The navigation being evaluated, over vue-router routes.
 */
export type MiddlewareContext = BaseMiddlewareContext<RouteLocationNormalized>;

/**
 * A middleware pipeline decision, over vue-router locations.
 */
export type MiddlewareResult = BaseMiddlewareResult<RouteLocationRaw>;

/**
 * A single navigation guard unit, over vue-router routes and locations.
 */
export type RouteMiddleware = BaseRouteMiddleware<RouteLocationNormalized, RouteLocationRaw>;
