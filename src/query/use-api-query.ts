/**
 * Reactive composable wrapping an `ApiQuery` instance.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ComputedRef } from 'vue';
import { computed, shallowRef } from 'vue';

import type { QueryParameters } from '@sinemacula/foundation/http/http-client';
import { ApiQuery } from '@sinemacula/foundation/query/api-query';

/**
 * Options accepted by {@link useApiQuery}.
 */
export interface UseApiQueryOptions {
    /** Builder that seeds the initial query state. */
    readonly initial?: (query: ApiQuery) => ApiQuery;
}

/**
 * The reactive query state returned by {@link useApiQuery}.
 */
export interface ApiQueryState {
    /** The current `ApiQuery` instance, updated on every `apply` or `reset`. */
    readonly query: ComputedRef<ApiQuery>;

    /** The current `QueryParameters`, recomputed whenever `query` changes. */
    readonly parameters: ComputedRef<QueryParameters>;

    /**
     * Replace the held query with the result of applying `mutate` to it. Edits
     * build on the held query, so a filter call on a field that already holds a
     * condition ANDs beside it rather than replacing it; to change a condition,
     * `reset()` and apply it again.
     */
    apply(mutate: (query: ApiQuery) => ApiQuery): void;

    /**
     * Restore the seed query captured at creation.
     */
    reset(): void;
}

/**
 * Create reactive query state for a single API endpoint.
 */
export function useApiQuery(options?: UseApiQueryOptions): ApiQueryState {
    const initial = options?.initial ? options.initial(ApiQuery.create()) : ApiQuery.create();
    const current = shallowRef<ApiQuery>(initial);

    const query = computed(() => current.value);
    const parameters = computed(() => current.value.toQueryParameters());

    /**
     * Replace the current query with the result of applying `mutate` to it.
     */
    function apply(mutate: (query: ApiQuery) => ApiQuery): void {
        current.value = mutate(current.value);
    }

    /**
     * Restore the seed query captured at creation.
     */
    function reset(): void {
        current.value = initial;
    }

    return { query, parameters, apply, reset };
}
