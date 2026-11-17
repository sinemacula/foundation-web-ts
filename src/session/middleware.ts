/**
 * Session route guards, safe to build before boot: all access is in `handle()`.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { RouteLocationRaw } from 'vue-router';

import type { MiddlewareContext, MiddlewareResult, RouteMiddleware } from '../router/middleware';
import { next, redirect } from '@sinemacula/foundation/router/middleware';
import { can } from './authorization';
import { appendRedirectTarget } from './redirect';
import { sessionContext } from './session-context';
import { useSessionStore } from './session-store';

/**
 * Build middleware that requires an authenticated session.
 *
 * @param redirectTo - where unauthenticated navigations are sent, carrying the
 * attempted path as a redirect query parameter; defaults to the login route
 */
export function authenticated(redirectTo?: RouteLocationRaw): RouteMiddleware {
    return {
        async handle(context: MiddlewareContext): Promise<MiddlewareResult> {
            await sessionContext().ready();

            if (useSessionStore().isAuthenticated) {
                return next();
            }

            return redirect(appendRedirectTarget(redirectTo ?? sessionContext().routes.login, context.to.fullPath));
        },
    };
}

/**
 * Build middleware that requires a signed-out visitor.
 *
 * @param redirectTo - where authenticated navigations are sent; defaults to the
 * home route
 */
export function guestOnly(redirectTo?: RouteLocationRaw): RouteMiddleware {
    return {
        async handle(): Promise<MiddlewareResult> {
            await sessionContext().ready();

            return useSessionStore().isAuthenticated ? redirect(redirectTo ?? sessionContext().routes.home) : next();
        },
    };
}

/**
 * Build middleware that requires a signed-in user holding a permission.
 *
 * A signed-out visitor, or one whose session is lost while the user loads, is
 * redirected to the login route as {@link authenticated} does; a signed-in
 * visitor lacking the permission is redirected to `redirectTo`.
 *
 * @example
 * ```ts
 * { path: '/users', meta: { middleware: [authorize('users.view')] } }
 * ```
 *
 * @param redirectTo - where a signed-in visitor lacking the permission is sent;
 * defaults to the forbidden route
 */
export function authorize(permission: string, redirectTo?: RouteLocationRaw): RouteMiddleware {
    return {
        async handle(context: MiddlewareContext): Promise<MiddlewareResult> {
            await sessionContext().ready();

            const store = useSessionStore();

            /** Redirect to the login route, carrying the attempted path. */
            const login = (): MiddlewareResult =>
                redirect(appendRedirectTarget(sessionContext().routes.login, context.to.fullPath));

            if (!store.isAuthenticated) {
                return login();
            }

            // A cold load has the token but not yet the user the check needs.
            await store.rehydrateUser();

            if (!store.isAuthenticated) {
                return login();
            }

            return can(permission) ? next() : redirect(redirectTo ?? sessionContext().routes.forbidden);
        },
    };
}
