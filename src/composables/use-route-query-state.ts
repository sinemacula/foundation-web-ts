/**
 * List-screen state held in the URL query so it survives reloads and links.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ComputedRef } from 'vue';
import { computed } from 'vue';
import type { LocationQuery, RouteLocationNormalizedLoaded, Router } from 'vue-router';

/**
 * Options accepted by {@link useRouteQueryState}.
 */
export interface RouteQueryStateOptions {
    /** Managed keys mapped to the value each falls back to when absent. */
    readonly defaults: Readonly<Record<string, string>>;
}

/**
 * The reactive query state and mutation helpers returned by
 * {@link useRouteQueryState}.
 */
export interface RouteQueryState {
    /** Every managed key's value: a string as-is, a repeated key's first value, otherwise its default. */
    readonly values: ComputedRef<Readonly<Record<string, string>>>;

    /**
     * Read a managed key's resolved value; an unmanaged key reads as ''.
     */
    get(key: string): string;

    /**
     * Merge a patch of managed keys into the URL query, null clearing a key;
     * unmanaged keys in the patch are ignored and other parameters preserved.
     * Patches set before the route commits, from any instance on the router,
     * accumulate, so a later call carries every earlier key; a patch with no
     * managed keys does not navigate.
     */
    set(patch: Readonly<Record<string, string | null>>): Promise<void>;
}

/**
 * Query patches set on one router since its current route committed.
 */
interface PendingQuery {
    /** The committed route the accumulated patch applies to. */
    readonly base: RouteLocationNormalizedLoaded;

    /** Every patch set since `base` committed, later keys winning. */
    readonly patch: Record<string, string | null>;

    /** Identifies the latest `set` merged into `patch`. */
    latest: object;
}

/** The accumulated query patch per router. */
const pendingQueries = new WeakMap<Router, PendingQuery>();

/**
 * Merge `patch` into the router's accumulated patch and replace the query with
 * every key set since the current route committed; the accumulation is dropped
 * once its latest navigation settles, whatever the outcome.
 */
function replaceQuery(router: Router, patch: Readonly<Record<string, string | null>>): Promise<void> {
    const base = router.currentRoute.value;
    const existing = pendingQueries.get(router);
    const token = {};
    const pending = existing?.base === base ? existing : { base, patch: {}, latest: token };

    pending.latest = token;

    pendingQueries.set(router, pending);
    Object.assign(pending.patch, patch);

    return router
        .replace({ query: applyPatch(base.query, pending.patch) })
        .finally(() => {
            if (pendingQueries.get(router) === pending && pending.latest === token) {
                pendingQueries.delete(router);
            }
        })
        .then(() => undefined);
}

/**
 * Apply a patch to a query, null removing a key.
 */
function applyPatch(query: LocationQuery, patch: Readonly<Record<string, string | null>>): LocationQuery {
    const next: LocationQuery = { ...query };

    for (const [key, value] of Object.entries(patch)) {
        if (value === null) {
            delete next[key];
        } else {
            next[key] = value;
        }
    }

    return next;
}

/**
 * Resolve a raw `route.query` value, falling back when it is absent.
 */
function resolveQueryValue(raw: string | null | (string | null)[] | undefined, fallback: string): string {
    if (raw === null || raw === undefined) {
        return fallback;
    }

    if (Array.isArray(raw)) {
        const first = raw[0];

        return first === null || first === undefined ? fallback : first;
    }

    return raw;
}

/**
 * Create reactive URL query state for a list screen.
 */
export function useRouteQueryState(router: Router, options: RouteQueryStateOptions): RouteQueryState {
    const { defaults } = options;

    const values = computed<Readonly<Record<string, string>>>(() => {
        const query = router.currentRoute.value.query;
        const result: Record<string, string> = {};

        for (const [key, defaultValue] of Object.entries(defaults)) {
            result[key] = resolveQueryValue(query[key], defaultValue);
        }

        return result;
    });

    /**
     * Read a managed key's resolved value, or '' when unmanaged.
     */
    function get(key: string): string {
        return values.value[key] ?? '';
    }

    /**
     * Merge the managed keys of a patch into the router's query.
     */
    async function set(patch: Readonly<Record<string, string | null>>): Promise<void> {
        const managed = Object.entries(patch).filter(([key]) => Object.hasOwn(defaults, key));

        if (managed.length > 0) {
            await replaceQuery(router, Object.fromEntries(managed));
        }
    }

    return { values, get, set };
}
