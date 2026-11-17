/**
 * Attaches a sanitised post-login return path to a vue-router location.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { RouteLocationRaw } from 'vue-router';

import { REDIRECT_QUERY_KEY } from '@sinemacula/foundation/session/redirect';

/**
 * Attach a redirect target to a route location as a query parameter, merging
 * into an object location's query or appending to a string location's query
 * string. Returns a new location; the input is never mutated.
 *
 * @param targetPath - must already be sanitised; this only encodes it
 */
export function appendRedirectTarget(location: RouteLocationRaw, targetPath: string): RouteLocationRaw {
    if (typeof location === 'string') {
        const separator = location.includes('?') ? '&' : '?';

        return `${location}${separator}${REDIRECT_QUERY_KEY}=${encodeURIComponent(targetPath)}`;
    }

    return { ...location, query: { ...location.query, [REDIRECT_QUERY_KEY]: targetPath } };
}
