/**
 * Users list query definition.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { filter } from '@sinemacula/foundation/query/list-filter';
import { defineListQuery } from '@sinemacula/foundation/query/list-query-definition';

/** Rows per page of the users list. */
export const USERS_PAGE_SIZE = 25;

/**
 * Search, sort and paging capabilities of the users list.
 */
export const userList = defineListQuery({
    filters: {},
    search: filter.search(),
    sortable: ['full_name', 'created_at'],
    defaultSort: { column: 'created_at', direction: 'desc' },
    pageSize: USERS_PAGE_SIZE,
});
