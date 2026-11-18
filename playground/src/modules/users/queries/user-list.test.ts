/**
 * Unit tests for the userList query definition.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { useListQuery } from '@sinemacula/foundation-web/query/use-list-query';
import { describe, expect, it } from 'vitest';

import { userList } from '@/modules/users/queries/user-list';

describe('userList', () => {
    it('declares no named filters', () => {
        expect(userList.filters).toEqual({});
    });

    it('sends the search term as the search parameter', () => {
        const { parameters, search } = useListQuery(userList);

        search('alice');

        expect(parameters.value['search']).toBe('alice');
    });

    it('sorts by full_name and created_at only', () => {
        expect(userList.sortable).toEqual(['full_name', 'created_at']);
    });

    it('defaults to sorting by created_at descending', () => {
        expect(userList.defaultSort).toEqual({ column: 'created_at', direction: 'desc' });
    });

    it('defaults to a page size of 25', () => {
        expect(userList.pageSize).toBe(25);
    });

    it('is frozen', () => {
        expect(Object.isFrozen(userList)).toBe(true);
    });
});
