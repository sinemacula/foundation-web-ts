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
     */
    set(patch: Readonly<Record<string, string | null>>): Promise<void>;
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
     * Merge a patch into the URL query; null removes a key and keys outside
     * `defaults` are ignored.
     */
    async function set(patch: Readonly<Record<string, string | null>>): Promise<void> {
        const current = router.currentRoute.value.query;
        const next: LocationQuery = { ...current };

        for (const [key, value] of Object.entries(patch)) {
            if (!(key in defaults)) {
                continue;
            }

            if (value === null) {
                delete next[key];
            } else {
                next[key] = value;
            }
        }

        await router.replace({ query: next });
    }

    return { values, get, set };
}
