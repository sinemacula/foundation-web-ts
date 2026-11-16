/**
 * Users list query definition.
 *
 * Declares the users list's query capabilities once, in the vocabulary the
 * screen and its tests use: free-text search over the columns the API declares
 * searchable, sorting by full name or creation date, and a 25-row page size. No
 * named filters yet - this list declares none.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { filter } from '@sinemacula/foundation/query/list-filter';
import { defineListQuery } from '@sinemacula/foundation/query/list-query-definition';

/** Rows per page of the users list. */
export const USERS_PAGE_SIZE = 25;

/**
 * The users list query definition, passed to `useListQuery` by
 * {@link useUsersList}.
 */
export const userList = defineListQuery({
    filters: {},
    search: filter.search(),
    sortable: ['full_name', 'created_at'],
    defaultSort: { column: 'created_at', direction: 'desc' },
    pageSize: USERS_PAGE_SIZE,
});
