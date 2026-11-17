/**
 * Screen-facing list-query composable driven by a {@link ListQueryDefinition}.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ComputedRef, Ref } from 'vue';
import { computed, ref } from 'vue';

import type { QueryParameters } from '@sinemacula/foundation/http/http-client';
import { ApiQuery } from '@sinemacula/foundation/query/api-query';
import type { ListFilter } from '@sinemacula/foundation/query/list-filter';
import type {
    FilterValueOf,
    ListQueryDefinition,
    SortDefault,
} from '@sinemacula/foundation/query/list-query-definition';
import { QueryError } from '@sinemacula/foundation/query/query-error';

const DEFAULT_PAGE_SIZE = 25;

const MIN_PAGE = 1;

/**
 * The reactive list-query state returned by {@link useListQuery}.
 *
 * Changing a filter, the search term or the sort resets the page to 1 so a
 * stale offset is never sent.
 */
export interface ListQuery<Filters extends Record<string, ListFilter<never>>> {
    /** The compiled `ApiQuery`, recomputed on any reactive state change. */
    readonly query: ComputedRef<ApiQuery>;

    /** The flat query-parameter record derived from {@link query}, ready for an `HttpClient` method. */
    readonly parameters: ComputedRef<QueryParameters>;

    /** The active filter values keyed by filter name; cleared filters are absent. */
    readonly filterValues: ComputedRef<Readonly<Partial<Record<keyof Filters & string, unknown>>>>;

    /** The current free-text search term, empty when no search is active. */
    readonly searchTerm: ComputedRef<string>;

    /** The active sort, or `null` when neither an explicit sort nor a `defaultSort` is set. */
    readonly sort: ComputedRef<SortDefault | null>;

    /** The current 1-based page number. */
    readonly page: ComputedRef<number>;

    /**
     * Set a named filter to a value; `null` is equivalent to
     * {@link clearFilter}.
     */
    setFilter<K extends keyof Filters & string>(name: K, value: FilterValueOf<Filters[K]> | null): void;

    /**
     * Clear a single named filter.
     */
    clearFilter(name: keyof Filters & string): void;

    /**
     * Clear all active filters.
     */
    clearFilters(): void;

    /**
     * Set the free-text search term; an empty string clears the search.
     */
    search(term: string): void;

    /**
     * Set the active sort column and direction.
     *
     * Without `direction`, re-sorting the active column toggles between `'asc'`
     * and `'desc'`; any other column starts at `'asc'`. Every column is
     * accepted when `definition.sortable` is undefined.
     *
     * @throws {QueryError} when `column` is not in `definition.sortable`
     */
    sortBy(column: string, direction?: 'asc' | 'desc'): void;

    /**
     * Advance to the next page.
     */
    next(): void;

    /**
     * Go to the previous page, clamped at page 1.
     */
    previous(): void;

    /**
     * Jump to an arbitrary page, clamped at page 1.
     */
    goTo(page: number): void;

    /**
     * Append a persistent refinement, applied after all standard query steps in
     * registration order.
     */
    refine(mutate: (query: ApiQuery) => ApiQuery): void;

    /**
     * Reset everything - filters, search, sort, page, and refinements - back to
     * the definition's defaults.
     */
    reset(): void;
}

/**
 * Create reactive list-query state from a {@link ListQueryDefinition}.
 */
export function useListQuery<Filters extends Record<string, ListFilter<never>>>(
    definition: ListQueryDefinition<Filters>,
): ListQuery<Filters> {
    const activeFilters = ref<Map<string, ActiveFilterEntry>>(new Map());
    const activeSearch = ref('');
    const activeSort = ref<SortDefault | null>(null);
    const currentPage = ref(MIN_PAGE);
    const refinements = ref<Array<(query: ApiQuery) => ApiQuery>>([]);

    const state: ListQueryState = { activeFilters, activeSearch, activeSort, currentPage, refinements };

    const query = computed<ApiQuery>(() => compileQuery(definition, state));
    const parameters = computed<QueryParameters>(() => query.value.toQueryParameters());
    const filterValues = computed<Readonly<Partial<Record<keyof Filters & string, unknown>>>>(() =>
        deriveFilterValues<Filters>(activeFilters.value),
    );
    const searchTerm = computed<string>(() => activeSearch.value);
    const sort = computed<SortDefault | null>(() => activeSort.value);
    const page = computed<number>(() => currentPage.value);

    return {
        query,
        parameters,
        filterValues,
        searchTerm,
        sort,
        page,
        ...createFilterMutations(definition, state),
        ...createNavigationMutations(definition, state),
    };
}

/**
 * A stored active filter: the typed filter instance and its concrete value.
 */
interface ActiveFilterEntry {
    /** The typed filter instance. */
    filter: ListFilter<unknown>;

    /** The concrete value applied through the filter. */
    value: unknown;
}

/**
 * The mutable reactive state behind a {@link useListQuery} instance.
 */
interface ListQueryState {
    /** Active filter entries in insertion order, keyed by filter name. */
    readonly activeFilters: Ref<Map<string, ActiveFilterEntry>>;

    /** The current free-text search term, empty when no search is active. */
    readonly activeSearch: Ref<string>;

    /** The active sort, or null when none is set. */
    readonly activeSort: Ref<SortDefault | null>;

    /** The current 1-based page number. */
    readonly currentPage: Ref<number>;

    /** The registered refinements, applied in call order. */
    readonly refinements: Ref<Array<(query: ApiQuery) => ApiQuery>>;
}

/**
 * The filter-set and search controls of the {@link ListQuery} contract.
 */
type FilterMutations<Filters extends Record<string, ListFilter<never>>> = Pick<
    ListQuery<Filters>,
    'setFilter' | 'clearFilter' | 'clearFilters' | 'search'
>;

/**
 * The sort, pagination, refinement and reset controls of the {@link ListQuery}
 * contract.
 */
type NavigationMutations<Filters extends Record<string, ListFilter<never>>> = Pick<
    ListQuery<Filters>,
    'sortBy' | 'next' | 'previous' | 'goTo' | 'refine' | 'reset'
>;

/**
 * Compile an {@link ApiQuery} from the current list-query state.
 *
 * Applies, in order: base shaping, active filters in insertion order, search,
 * sort (explicit, then default), pagination and refinements.
 */
function compileQuery<Filters extends Record<string, ListFilter<never>>>(
    definition: ListQueryDefinition<Filters>,
    state: ListQueryState,
): ApiQuery {
    let q = ApiQuery.create();

    if (definition.base) {
        q = definition.base(q);
    }

    for (const entry of state.activeFilters.value.values()) {
        q = entry.filter.apply(q, entry.value);
    }

    const { search: searchFilter } = definition;

    if (state.activeSearch.value !== '' && searchFilter !== undefined) {
        q = searchFilter.apply(q, state.activeSearch.value);
    }

    const sort = state.activeSort.value ?? definition.defaultSort ?? null;

    if (sort !== null) {
        q = q.orderBy(sort.column, sort.direction);
    }

    q = q.limit(definition.pageSize ?? DEFAULT_PAGE_SIZE).page(state.currentPage.value);

    for (const refineFn of state.refinements.value) {
        q = refineFn(q);
    }

    return q;
}

/**
 * Snapshot the active filter values as a plain record keyed by filter name.
 */
function deriveFilterValues<Filters extends Record<string, ListFilter<never>>>(
    activeFilters: Map<string, ActiveFilterEntry>,
): Readonly<Partial<Record<keyof Filters & string, unknown>>> {
    const result: Partial<Record<string, unknown>> = {};

    for (const [key, entry] of activeFilters) {
        result[key] = entry.value;
    }

    return result as Readonly<Partial<Record<keyof Filters & string, unknown>>>;
}

/**
 * Build the filter-set and search controls for a {@link useListQuery} instance.
 */
function createFilterMutations<Filters extends Record<string, ListFilter<never>>>(
    definition: ListQueryDefinition<Filters>,
    state: ListQueryState,
): FilterMutations<Filters> {
    /**
     * Set a named filter to a concrete value, or clear it when `value` is null.
     */
    function setFilter<K extends keyof Filters & string>(name: K, value: FilterValueOf<Filters[K]> | null): void {
        if (value === null) {
            clearFilter(name);

            return;
        }

        const filterDef: ListFilter<unknown> | undefined = (definition.filters as Record<string, ListFilter<unknown>>)[
            name
        ];

        if (filterDef === undefined) {
            return;
        }

        const next = new Map(state.activeFilters.value);

        next.set(name, { filter: filterDef, value });
        state.activeFilters.value = next;
        state.currentPage.value = MIN_PAGE;
    }

    /**
     * Remove a single named filter from the active set.
     */
    function clearFilter(name: keyof Filters & string): void {
        if (!state.activeFilters.value.has(name)) {
            return;
        }

        const next = new Map(state.activeFilters.value);

        next.delete(name);
        state.activeFilters.value = next;
        state.currentPage.value = MIN_PAGE;
    }

    /**
     * Remove every active filter.
     */
    function clearFilters(): void {
        if (state.activeFilters.value.size === 0) {
            return;
        }

        state.activeFilters.value = new Map();
        state.currentPage.value = MIN_PAGE;
    }

    /**
     * Set the free-text search term; an empty string clears the search.
     */
    function search(term: string): void {
        state.activeSearch.value = term;
        state.currentPage.value = MIN_PAGE;
    }

    return { setFilter, clearFilter, clearFilters, search };
}

/**
 * Build the sort, pagination, refinement and reset controls for a
 * {@link useListQuery} instance.
 */
function createNavigationMutations<Filters extends Record<string, ListFilter<never>>>(
    definition: ListQueryDefinition<Filters>,
    state: ListQueryState,
): NavigationMutations<Filters> {
    /**
     * Set or toggle the active sort, rejecting columns outside `sortable`.
     *
     * @throws {QueryError} when `column` is not in `sortable`
     */
    function sortBy(column: string, direction?: 'asc' | 'desc'): void {
        const { sortable } = definition;

        if (sortable !== undefined && !sortable.includes(column)) {
            throw new QueryError(
                `Cannot sort by '${column}'. Allowed columns: ${sortable.map(c => `'${c}'`).join(', ')}.`,
            );
        }

        let resolvedDirection: 'asc' | 'desc';

        if (direction !== undefined) {
            resolvedDirection = direction;
        } else if (state.activeSort.value?.column === column) {
            resolvedDirection = state.activeSort.value.direction === 'asc' ? 'desc' : 'asc';
        } else {
            resolvedDirection = 'asc';
        }

        state.activeSort.value = { column, direction: resolvedDirection };
        state.currentPage.value = MIN_PAGE;
    }

    /**
     * Advance to the next page.
     */
    function next(): void {
        state.currentPage.value += 1;
    }

    /**
     * Step back one page, clamped at page 1.
     */
    function previous(): void {
        state.currentPage.value = Math.max(MIN_PAGE, state.currentPage.value - 1);
    }

    /**
     * Jump to an arbitrary page, clamped at page 1.
     */
    function goTo(targetPage: number): void {
        state.currentPage.value = Math.max(MIN_PAGE, targetPage);
    }

    /**
     * Append a persistent refinement applied after all standard query steps.
     */
    function refine(mutate: (query: ApiQuery) => ApiQuery): void {
        state.refinements.value = [...state.refinements.value, mutate];
    }

    /**
     * Reset filters, search, sort, page and refinements to the definition's
     * defaults.
     */
    function reset(): void {
        state.activeFilters.value = new Map();
        state.activeSearch.value = '';
        state.activeSort.value = null;
        state.currentPage.value = MIN_PAGE;
        state.refinements.value = [];
    }

    return { sortBy, next, previous, goTo, refine, reset };
}
