/**
 * Users list screen state over the list query, users client and resource.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { PaginationMeta } from '@sinemacula/foundation/query/envelope';
import type { SortDefault } from '@sinemacula/foundation/query/list-query-definition';
import { useListQuery } from '@sinemacula/web-core/query/use-list-query';
import { useResource } from '@sinemacula/web-core/query/use-resource';
import type { ComputedRef, Ref } from 'vue';
import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue';

import { PlaygroundError } from '@/errors/playground-error';
import { api } from '@/services/api';

import { USERS_PAGE_SIZE, userList } from '../queries/user-list';
import type { UserListItem } from '../services/users-api';
import { createUsersClient } from '../services/users-api';

/** Debounce window applied to free-text search input, in milliseconds. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Parse the API's `YYYY-MM-DD HH:MM:SS` wire timestamp as a UTC instant.
 *
 * @throws PlaygroundError when the timestamp cannot be parsed
 */
export function parseWireTimestamp(wireTimestamp: string): Date {
    const parsed = Date.parse(`${wireTimestamp.replace(' ', 'T')}Z`);

    if (Number.isNaN(parsed)) {
        throw new PlaygroundError(`The wire timestamp "${wireTimestamp}" could not be parsed.`);
    }

    return new Date(parsed);
}

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

    /**
     * Advance to the next page; a no-op once `meta` reports the last page.
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
        if (debounceTimer !== undefined) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => commit(value), SEARCH_DEBOUNCE_MS);
    });

    if (getCurrentScope() !== undefined) {
        onScopeDispose(() => {
            if (debounceTimer !== undefined) {
                clearTimeout(debounceTimer);
            }
        });
    }

    return searchInput;
}

/**
 * Build a `next()` control that is a no-op once `meta` reports no further page.
 */
function createGuardedNext(meta: ComputedRef<PaginationMeta | null>, advance: () => void): () => void {
    return (): void => {
        const currentMeta = meta.value;

        if (currentMeta !== null && !currentMeta.hasMore) {
            return;
        }

        advance();
    };
}

/**
 * Build the reactive state and controls for the users list screen.
 */
export function useUsersList(): UsersList {
    const list = useListQuery(userList);
    const client = createUsersClient(api());

    const resource = useResource({
        fetcher: signal => client.list(list.query.value, { signal }),
        watch: list.parameters,
    });

    const rows = computed<readonly UserListItem[]>(() => resource.data.value?.items ?? []);
    const meta = computed<PaginationMeta | null>(() => resource.data.value?.meta ?? null);
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
        next: createGuardedNext(meta, list.next),
        previous: list.previous,
        refetch: resource.refetch,
    };
}
