/**
 * Users list screen state over the list query, users client and resource.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ApiQuery } from '@sinemacula/foundation/query/api-query';
import type { ListResult, PaginationMeta } from '@sinemacula/foundation/query/envelope';
import type { SortDefault } from '@sinemacula/foundation/query/list-query-definition';
import { useListQuery } from '@sinemacula/foundation-web/query/use-list-query';
import { useResource } from '@sinemacula/foundation-web/query/use-resource';
import type { ComputedRef, Ref } from 'vue';
import { computed, onScopeDispose, ref, toRaw, watch } from 'vue';

import { api } from '@/services/api';

import { USERS_PAGE_SIZE, userList } from '../queries/user-list';
import type { UserListItem } from '../services/users-api';
import { createUsersClient } from '../services/users-api';

/** Debounce window applied to free-text search input, in milliseconds. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Reactive state and controls for the users list screen.
 */
export interface UsersList {
    /** The current page of mapped user rows. */
    readonly rows: ComputedRef<readonly UserListItem[]>;

    /** Pagination metadata for the current page, or null before the first response. */
    readonly meta: ComputedRef<PaginationMeta | null>;

    /** The number of the last page, or null before the first response or when the list does not report a total. */
    readonly lastPage: ComputedRef<number | null>;

    /** True while the latest request is in flight. */
    readonly isLoading: Ref<boolean>;

    /** True once a request has resolved successfully at least once. */
    readonly hasLoaded: ComputedRef<boolean>;

    /** Whatever the latest request threw, or null when none. */
    readonly error: Ref<unknown>;

    /** Two-way bound search field value; debounces into the list query. */
    readonly searchInput: Ref<string>;

    /** The search term currently committed to the list query. */
    readonly searchTerm: ComputedRef<string>;

    /**
     * Commit a search term immediately, bypassing the debounce.
     */
    search(term: string): void;

    /** The active sort, or null when none is set. */
    readonly sort: ComputedRef<SortDefault | null>;

    /**
     * Sort by a column, toggling direction when the column is already active.
     */
    sortBy(column: string): void;

    /** The current 1-based page number. */
    readonly page: ComputedRef<number>;

    /** True when the current query's page has settled and `meta` does not report it as the last. */
    readonly hasNextPage: ComputedRef<boolean>;

    /**
     * Advance to the next page; a no-op while `hasNextPage` is false.
     */
    next(): void;

    /**
     * Go to the previous page, clamped at page 1.
     */
    previous(): void;

    /**
     * Re-run the current request.
     */
    refetch(): Promise<void>;
}

/**
 * Build a search input ref that commits its value once typing settles.
 */
function useSearchDebounce(commit: (term: string) => void, initial: string): Ref<string> {
    const searchInput = ref(initial);
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    watch(searchInput, value => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => commit(value), SEARCH_DEBOUNCE_MS);
    });

    onScopeDispose(() => clearTimeout(debounceTimer), true);

    return searchInput;
}

/**
 * A settled page of users and the query it was fetched with.
 */
interface UsersPage {
    /** The query the page was fetched with. */
    readonly query: ApiQuery;

    /** The mapped page of users. */
    readonly result: ListResult<UserListItem>;
}

/**
 * Build the reactive state and controls for the users list screen.
 */
export function useUsersList(): UsersList {
    const list = useListQuery(userList);
    const client = createUsersClient(api());

    const resource = useResource<UsersPage>({
        fetcher: async signal => {
            const query = list.query.value;

            return { query, result: await client.list(query, { signal }) };
        },
        watch: list.parameters,
    });

    const rows = computed<readonly UserListItem[]>(() => resource.data.value?.result.items ?? []);
    const meta = computed<PaginationMeta | null>(() => resource.data.value?.result.meta ?? null);
    const hasNextPage = computed<boolean>(() => {
        const settled = resource.data.value;

        return settled !== null && toRaw(settled.query) === list.query.value && settled.result.meta?.hasMore !== false;
    });
    const lastPage = computed<number | null>(() =>
        meta.value?.mode === 'length-aware' ? Math.max(1, Math.ceil(meta.value.total / USERS_PAGE_SIZE)) : null,
    );
    const searchInput = useSearchDebounce(list.search, list.searchTerm.value);

    return {
        rows,
        meta,
        lastPage,
        isLoading: resource.isLoading,
        hasLoaded: resource.hasLoaded,
        error: resource.error,
        searchInput,
        searchTerm: list.searchTerm,
        search: list.search,
        sort: list.sort,
        sortBy: list.sortBy,
        page: list.page,
        hasNextPage,
        next: (): void => {
            if (hasNextPage.value) {
                list.next();
            }
        },
        previous: list.previous,
        refetch: resource.refetch,
    };
}
