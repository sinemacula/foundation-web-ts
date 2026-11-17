/**
 * List-screen state held in the URL query so it survives reloads and links.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ComputedRef } from 'vue';
import { computed } from 'vue';
import type { LocationQuery, Router } from 'vue-router';

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
     * Patches set in the same tick, from any instance on the router, land in
     * one navigation that waits for the previous one to settle; they are
     * dropped if the route path has changed by then.
     */
    set(patch: Readonly<Record<string, string | null>>): Promise<void>;
}

/**
 * Query patches waiting for the next navigation on one router.
 */
interface QueryBatchState {
    /** The merged patch for the batch not yet navigated, or null when none is open. */
    pending: Record<string, string | null> | null;

    /** The latest batch's navigation, which the next batch waits behind. */
    tail: Promise<void>;
}

/** Pending query patches per router. */
const batches = new WeakMap<Router, QueryBatchState>();

/**
 * Merge `patch` into the router's open batch, opening one behind the previous
 * navigation when none is open.
 *
 * @returns the navigation that applies the batch
 */
function enqueuePatch(router: Router, patch: Readonly<Record<string, string | null>>): Promise<void> {
    const state = batches.get(router) ?? { pending: null, tail: Promise.resolve() };

    batches.set(router, state);

    if (state.pending === null) {
        const pending: Record<string, string | null> = {};
        const path = router.currentRoute.value.path;

        state.pending = pending;
        state.tail = state.tail
            .catch(() => undefined)
            .then(async () => {
                state.pending = null;

                if (router.currentRoute.value.path === path) {
                    await router.replace({ query: applyPatch(router.currentRoute.value.query, pending) });
                }
            });
    }

    Object.assign(state.pending, patch);

    return state.tail;
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
     * Queue the managed keys of a patch for the router's next query update.
     */
    function set(patch: Readonly<Record<string, string | null>>): Promise<void> {
        const managed = Object.fromEntries(Object.entries(patch).filter(([key]) => Object.hasOwn(defaults, key)));

        return enqueuePatch(router, managed);
    }

    return { values, get, set };
}
