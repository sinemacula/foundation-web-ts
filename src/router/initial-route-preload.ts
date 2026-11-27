/**
 * Best-effort loading of the first page's lazy route components during boot.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { RouteRecordNormalized, RouteRecordRaw } from 'vue-router';
import { createMemoryHistory, createRouter } from 'vue-router';

/**
 * Start loading the lazy components of the routes `location` matches, so the
 * first navigation finds them loaded. Redirects and guards are not followed: a
 * location that only redirects preloads nothing.
 */
export function preloadInitialRoute(routes: readonly RouteRecordRaw[], location: string): void {
    // The real navigation loads the same components and surfaces any failure.
    for (const record of matchedRecords(routes, location)) {
        for (const component of Object.values(record.components ?? {})) {
            if (isLazyComponent(component)) {
                try {
                    Promise.resolve(component()).catch(() => undefined);
                } catch {
                    // Best-effort, as above.
                }
            }
        }
    }
}

/**
 * The records `location` matches, or none when the routes cannot be resolved.
 */
function matchedRecords(routes: readonly RouteRecordRaw[], location: string): readonly RouteRecordNormalized[] {
    try {
        return createRouter({ history: createMemoryHistory(), routes: [...routes] }).resolve(location).matched;
    } catch {
        return [];
    }
}

/**
 * Whether a route component is a lazy loader, by the router's own rule: a
 * function that is not itself a component.
 */
function isLazyComponent(component: unknown): component is () => unknown {
    return (
        typeof component === 'function' &&
        !('displayName' in component) &&
        !('props' in component) &&
        !('__vccOpts' in component)
    );
}
