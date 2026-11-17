/**
 * Unit tests for the useListQuery composable.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it } from 'vitest';

import { filter } from '@sinemacula/foundation/query/list-filter';
import { defineListQuery } from '@sinemacula/foundation/query/list-query-definition';
import type { ListQuery } from './use-list-query';
import { useListQuery } from './use-list-query';

/**
 * Parse the `filters` parameter back to an object.
 */
function parsedFilters(params: Record<string, unknown>): unknown {
    if (params['filters'] === undefined) {
        return {};
    }

    return JSON.parse(String(params['filters']));
}

/**
 * Build a wire object, keeping $-prefixed keys out of object literals.
 */
function wire(entries: ReadonlyArray<readonly [string, unknown]>): Record<string, unknown> {
    return Object.fromEntries(entries);
}

const sharedDefinition = defineListQuery({
    filters: {
        status: filter.equals('status'),
        name: filter.equals('name'),
        ids: filter.anyOf('id'),
        ageRange: filter.between('age'),
        minAge: filter.atLeast('age'),
        maxAge: filter.atMost('age'),
        active: filter.boolean('active'),
        hasEmail: filter.present('email'),
        tags: filter.contains('tags'),
        authorName: filter.equals('posts.author.name'),
    },
    search: filter.search(),
    sortable: ['name', 'createdAt', 'age'],
    defaultSort: { column: 'name', direction: 'asc' },
    pageSize: 10,
});

type SharedListQuery = ListQuery<NonNullable<(typeof sharedDefinition)['filters']>>;

describe('useListQuery', () => {
    describe('initial state', () => {
        it('starts on page 1', () => {
            const { page } = useListQuery(sharedDefinition);

            expect(page.value).toBe(1);
        });

        it('starts with no active filters', () => {
            const { filterValues } = useListQuery(sharedDefinition);

            expect(filterValues.value).toEqual({});
        });

        it('starts with an empty search term', () => {
            const { searchTerm } = useListQuery(sharedDefinition);

            expect(searchTerm.value).toBe('');
        });

        it('starts with no explicit sort (null)', () => {
            const { sort } = useListQuery(sharedDefinition);

            expect(sort.value).toBeNull();
        });

        it('applies default pageSize of 25 when not specified', () => {
            const { parameters } = useListQuery(defineListQuery({}));

            expect(parameters.value['limit']).toBe(25);
        });

        it('applies the definition pageSize', () => {
            const { parameters } = useListQuery(sharedDefinition);

            expect(parameters.value['limit']).toBe(10);
        });

        it('applies the defaultSort when no explicit sort is set', () => {
            const { parameters } = useListQuery(sharedDefinition);

            expect(parameters.value['order']).toBe('name');
        });

        it('emits page 1 initially', () => {
            const { parameters } = useListQuery(sharedDefinition);

            expect(parameters.value['page']).toBe(1);
        });

        it('emits no filters parameter when no filters are set', () => {
            const { parameters } = useListQuery(defineListQuery({}));

            expect(parameters.value['filters']).toBeUndefined();
        });
    });

    describe('base', () => {
        it('applies the base function first', () => {
            const definition = defineListQuery({
                base: q => q.fieldsFor('users', ['id', 'name']),
            });
            const { parameters } = useListQuery(definition);

            expect(parameters.value['fields[users]']).toBe('id,name');
        });

        it('applies base before filters', () => {
            const definition = defineListQuery({
                base: q => q.where('tenant', 'acme'),
                filters: {
                    status: filter.equals('status'),
                },
            });
            const { parameters, setFilter } = useListQuery(definition);

            setFilter('status', 'active');

            const filters = parsedFilters(parameters.value);

            expect(filters).toEqual({ tenant: 'acme', status: 'active' });
        });
    });

    describe('setFilter - equals', () => {
        it('applies the filter to the compiled query', () => {
            const { parameters, setFilter } = useListQuery(sharedDefinition);

            setFilter('status', 'active');

            expect(parsedFilters(parameters.value)).toEqual({ status: 'active' });
        });

        it('updates filterValues', () => {
            const { filterValues, setFilter } = useListQuery(sharedDefinition);

            setFilter('status', 'active');

            expect(filterValues.value.status).toBe('active');
        });

        it('resets page to 1 when a filter is set', () => {
            const { page, setFilter, goTo } = useListQuery(sharedDefinition);

            goTo(3);
            setFilter('status', 'active');

            expect(page.value).toBe(1);
        });

        it('applying multiple filters accumulates them', () => {
            const { parameters, setFilter } = useListQuery(sharedDefinition);

            setFilter('status', 'active');
            setFilter('name', 'alice');

            const filters = parsedFilters(parameters.value);

            expect(filters).toEqual(
                wire([
                    ['status', 'active'],
                    ['name', 'alice'],
                ]),
            );
        });
    });

    describe('setFilter - dot-path relation nesting', () => {
        it('nests posts.author.name correctly', () => {
            const { parameters, setFilter } = useListQuery(sharedDefinition);

            setFilter('authorName', 'Alice');

            expect(parsedFilters(parameters.value)).toEqual({ posts: { author: { name: 'Alice' } } });
        });
    });

    describe('setFilter - boolean false', () => {
        it('emits false as a real equality filter, not a clear', () => {
            const { parameters, setFilter } = useListQuery(sharedDefinition);

            setFilter('active', false);

            expect(parsedFilters(parameters.value)).toEqual({ active: false });
        });

        it('includes false in filterValues', () => {
            const { filterValues, setFilter } = useListQuery(sharedDefinition);

            setFilter('active', false);

            expect(filterValues.value.active).toBe(false);
        });
    });

    describe('setFilter - operators', () => {
        it.each<[string, (setFilter: SharedListQuery['setFilter']) => void, Record<string, unknown>]>([
            ['present true as $notNull', set => set('hasEmail', true), wire([['email', wire([['$notNull', true]])]])],
            ['present false as $null', set => set('hasEmail', false), wire([['email', wire([['$null', true]])]])],
            ['anyOf as $in', set => set('ids', [1, 2, 3]), wire([['id', wire([['$in', [1, 2, 3]]])]])],
            ['between as $between', set => set('ageRange', [18, 65]), wire([['age', wire([['$between', [18, 65]]])]])],
            ['atLeast as $ge', set => set('minAge', 18), wire([['age', wire([['$ge', 18]])]])],
            ['atMost as $le', set => set('maxAge', 65), wire([['age', wire([['$le', 65]])]])],
            ['contains a scalar', set => set('tags', 'news'), wire([['tags', wire([['$contains', 'news']])]])],
            [
                'contains an array',
                set => set('tags', ['news', 'sport']),
                wire([['tags', wire([['$contains', ['news', 'sport']]])]]),
            ],
        ])('applies %s', (_label, apply, expected) => {
            const { parameters, setFilter } = useListQuery(sharedDefinition);

            apply(setFilter);

            expect(parsedFilters(parameters.value)).toEqual(expected);
        });
    });

    describe('setFilter - null clears', () => {
        it('setFilter(name, null) clears the filter', () => {
            const { parameters, filterValues, setFilter } = useListQuery(sharedDefinition);

            setFilter('status', 'active');
            setFilter('status', null);

            expect(parsedFilters(parameters.value)).toEqual({});
            expect(filterValues.value.status).toBeUndefined();
        });

        it('setFilter(name, null) resets page to 1', () => {
            const { page, setFilter, goTo } = useListQuery(sharedDefinition);

            setFilter('status', 'active');
            goTo(5);
            setFilter('status', null);

            expect(page.value).toBe(1);
        });
    });

    describe('clearFilter', () => {
        it('removes the named filter', () => {
            const { parameters, setFilter, clearFilter } = useListQuery(sharedDefinition);

            setFilter('status', 'active');
            clearFilter('status');

            expect(parsedFilters(parameters.value)).toEqual({});
        });

        it('resets page to 1 when a filter is cleared', () => {
            const { page, setFilter, clearFilter, goTo } = useListQuery(sharedDefinition);

            setFilter('status', 'active');
            goTo(4);
            clearFilter('status');

            expect(page.value).toBe(1);
        });

        it('is a no-op when the filter is not set', () => {
            const { page, clearFilter, goTo } = useListQuery(sharedDefinition);

            goTo(3);
            clearFilter('status');

            expect(page.value).toBe(3);
        });
    });

    describe('clearFilters', () => {
        it('removes all active filters', () => {
            const { parameters, filterValues, setFilter, clearFilters } = useListQuery(sharedDefinition);

            setFilter('status', 'active');
            setFilter('name', 'alice');
            clearFilters();

            expect(parsedFilters(parameters.value)).toEqual({});
            expect(filterValues.value).toEqual({});
        });

        it('resets page to 1', () => {
            const { page, setFilter, clearFilters, goTo } = useListQuery(sharedDefinition);

            setFilter('status', 'active');
            goTo(5);
            clearFilters();

            expect(page.value).toBe(1);
        });

        it('is a no-op when no filters are active (page not reset)', () => {
            const { page, clearFilters, goTo } = useListQuery(sharedDefinition);

            goTo(3);
            clearFilters();

            expect(page.value).toBe(3);
        });
    });

    describe('search', () => {
        it('compiles the search term into the query', () => {
            const { parameters, search } = useListQuery(sharedDefinition);

            search('alice');

            expect(parameters.value['search']).toBe('alice');
            expect(parameters.value['filters']).toBeUndefined();
        });

        it('updates searchTerm', () => {
            const { searchTerm, search } = useListQuery(sharedDefinition);

            search('bob');

            expect(searchTerm.value).toBe('bob');
        });

        it('resets page to 1', () => {
            const { page, search, goTo } = useListQuery(sharedDefinition);

            goTo(4);
            search('alice');

            expect(page.value).toBe(1);
        });

        it("clears the search when called with ''", () => {
            const { parameters, searchTerm, search } = useListQuery(sharedDefinition);

            search('alice');
            search('');

            expect(searchTerm.value).toBe('');
            expect(parameters.value['search']).toBeUndefined();
        });

        it('does not emit the search term when it is empty', () => {
            const { parameters } = useListQuery(sharedDefinition);

            expect(parameters.value['search']).toBeUndefined();
        });
    });

    describe('sortBy - defaultSort', () => {
        it('emits defaultSort when no explicit sort has been set', () => {
            const { parameters } = useListQuery(sharedDefinition);

            expect(parameters.value['order']).toBe('name');
        });

        it('emits no order when there is no defaultSort and no explicit sort', () => {
            const definition = defineListQuery({ sortable: ['name'] });
            const { parameters } = useListQuery(definition);

            expect(parameters.value['order']).toBeUndefined();
        });
    });

    describe('sortBy - explicit sort', () => {
        it('sets an explicit ascending sort', () => {
            const { parameters, sortBy } = useListQuery(sharedDefinition);

            sortBy('createdAt', 'asc');

            expect(parameters.value['order']).toBe('createdAt');
        });

        it('sets an explicit descending sort', () => {
            const { parameters, sortBy } = useListQuery(sharedDefinition);

            sortBy('createdAt', 'desc');

            expect(parameters.value['order']).toBe('createdAt:desc');
        });

        it('updates the sort computed ref', () => {
            const { sort, sortBy } = useListQuery(sharedDefinition);

            sortBy('createdAt', 'desc');

            expect(sort.value).toEqual({ column: 'createdAt', direction: 'desc' });
        });

        it('overrides the defaultSort', () => {
            const { parameters, sortBy } = useListQuery(sharedDefinition);

            sortBy('age', 'desc');

            expect(parameters.value['order']).toBe('age:desc');
        });

        it('resets page to 1', () => {
            const { page, sortBy, goTo } = useListQuery(sharedDefinition);

            goTo(3);
            sortBy('age', 'asc');

            expect(page.value).toBe(1);
        });
    });

    describe('sortBy - toggle', () => {
        it('defaults to asc on first call without explicit direction', () => {
            const { sort, sortBy } = useListQuery(sharedDefinition);

            sortBy('createdAt');

            expect(sort.value).toEqual({ column: 'createdAt', direction: 'asc' });
        });

        it('toggles from asc to desc when the same column is called again', () => {
            const { sort, sortBy } = useListQuery(sharedDefinition);

            sortBy('createdAt');
            sortBy('createdAt');

            expect(sort.value).toEqual({ column: 'createdAt', direction: 'desc' });
        });

        it('toggles from desc to asc on the third call', () => {
            const { sort, sortBy } = useListQuery(sharedDefinition);

            sortBy('createdAt');
            sortBy('createdAt');
            sortBy('createdAt');

            expect(sort.value).toEqual({ column: 'createdAt', direction: 'asc' });
        });

        it('explicit direction overrides toggle and does not flip', () => {
            const { sort, sortBy } = useListQuery(sharedDefinition);

            sortBy('createdAt');
            sortBy('createdAt', 'desc');

            expect(sort.value).toEqual({ column: 'createdAt', direction: 'desc' });
        });

        it('switching to a different column resets to asc without direction', () => {
            const { sort, sortBy } = useListQuery(sharedDefinition);

            sortBy('createdAt', 'desc');
            sortBy('age');

            expect(sort.value).toEqual({ column: 'age', direction: 'asc' });
        });
    });

    describe('sortBy - non-sortable column', () => {
        it('throws an Error naming the rejected column and the allowed list', () => {
            const { sortBy } = useListQuery(sharedDefinition);

            expect(() => sortBy('unknown')).toThrowError(/unknown/);
            expect(() => sortBy('unknown')).toThrowError(/name.*createdAt.*age|createdAt.*name.*age/);
        });

        it('allows any column when sortable is undefined', () => {
            const definition = defineListQuery({});
            const { parameters, sortBy } = useListQuery(definition);

            sortBy('anyColumn', 'asc');

            expect(parameters.value['order']).toBe('anyColumn');
        });
    });

    describe('next', () => {
        it('advances to the next page', () => {
            const { page, next } = useListQuery(sharedDefinition);

            next();

            expect(page.value).toBe(2);
        });

        it('does not touch filters or sort', () => {
            const { parameters, setFilter, next } = useListQuery(sharedDefinition);

            setFilter('status', 'active');
            next();

            expect(parsedFilters(parameters.value)).toEqual({ status: 'active' });
        });
    });

    describe('previous', () => {
        it('goes to the previous page', () => {
            const { page, goTo, previous } = useListQuery(sharedDefinition);

            goTo(5);
            previous();

            expect(page.value).toBe(4);
        });

        it('is clamped at page 1', () => {
            const { page, previous } = useListQuery(sharedDefinition);

            previous();

            expect(page.value).toBe(1);
        });
    });

    describe('goTo', () => {
        it('jumps to the specified page', () => {
            const { page, goTo } = useListQuery(sharedDefinition);

            goTo(7);

            expect(page.value).toBe(7);
        });

        it('is clamped at page 1', () => {
            const { page, goTo } = useListQuery(sharedDefinition);

            goTo(-5);

            expect(page.value).toBe(1);
        });

        it('does not touch filters', () => {
            const { filterValues, setFilter, goTo } = useListQuery(sharedDefinition);

            setFilter('status', 'active');
            goTo(3);

            expect(filterValues.value.status).toBe('active');
        });
    });

    describe('page reset behaviour', () => {
        it('resets to 1 when a filter changes', () => {
            const { page, setFilter, goTo } = useListQuery(sharedDefinition);

            goTo(5);
            setFilter('status', 'active');

            expect(page.value).toBe(1);
        });

        it('resets to 1 when search changes', () => {
            const { page, search, goTo } = useListQuery(sharedDefinition);

            goTo(5);
            search('alice');

            expect(page.value).toBe(1);
        });

        it('resets to 1 when sort changes', () => {
            const { page, sortBy, goTo } = useListQuery(sharedDefinition);

            goTo(5);
            sortBy('createdAt', 'desc');

            expect(page.value).toBe(1);
        });

        it('does not reset on next/previous/goTo', () => {
            const { page, setFilter, next, previous, goTo } = useListQuery(sharedDefinition);

            setFilter('status', 'active');
            goTo(4);
            next();

            expect(page.value).toBe(5);

            previous();

            expect(page.value).toBe(4);
        });
    });

    describe('refine', () => {
        it('appends a persistent advanced refinement after standard steps', () => {
            const { parameters, refine } = useListQuery(sharedDefinition);

            refine(q => q.aggregatesFor('users', ['posts_count']));

            expect(parameters.value['aggregates[users]']).toBe('posts_count');
        });

        it('multiple refinements are applied in call order', () => {
            const { parameters, refine } = useListQuery(sharedDefinition);

            refine(q => q.aggregatesFor('users', ['posts_count']));
            refine(q => q.fieldsFor('users', ['id', 'name']));

            expect(parameters.value['aggregates[users]']).toBe('posts_count');
            expect(parameters.value['fields[users]']).toBe('id,name');
        });

        it('refinements persist across filter changes', () => {
            const { parameters, setFilter, refine } = useListQuery(sharedDefinition);

            refine(q => q.aggregatesFor('users', ['posts_count']));
            setFilter('status', 'active');

            expect(parameters.value['aggregates[users]']).toBe('posts_count');
        });

        it('refinements are applied after sort and pagination', () => {
            const definition = defineListQuery({});
            const { parameters, refine } = useListQuery(definition);

            refine(q => q.fieldsFor('users', ['id']));

            expect(parameters.value['fields[users]']).toBe('id');
        });
    });

    describe('reset', () => {
        it('clears all active filters', () => {
            const { filterValues, setFilter, reset } = useListQuery(sharedDefinition);

            setFilter('status', 'active');
            reset();

            expect(filterValues.value).toEqual({});
        });

        it('clears the search term', () => {
            const { searchTerm, search, reset } = useListQuery(sharedDefinition);

            search('alice');
            reset();

            expect(searchTerm.value).toBe('');
        });

        it('clears the explicit sort (null)', () => {
            const { sort, sortBy, reset } = useListQuery(sharedDefinition);

            sortBy('age', 'desc');
            reset();

            expect(sort.value).toBeNull();
        });

        it('resets page to 1', () => {
            const { page, goTo, reset } = useListQuery(sharedDefinition);

            goTo(5);
            reset();

            expect(page.value).toBe(1);
        });

        it('clears all refinements', () => {
            const { parameters, refine, reset } = useListQuery(sharedDefinition);

            refine(q => q.aggregatesFor('users', ['posts_count']));
            reset();

            expect(parameters.value['aggregates[users]']).toBeUndefined();
        });

        it('restores defaultSort after reset', () => {
            const { parameters, sortBy, reset } = useListQuery(sharedDefinition);

            sortBy('age', 'desc');
            reset();

            expect(parameters.value['order']).toBe('name');
        });

        it('restores no filters, no search, no order when definition has no defaults', () => {
            const definition = defineListQuery({});
            const { parameters, search, sortBy, reset } = useListQuery(definition);

            search('test');
            sortBy('anyCol');
            reset();

            expect(parameters.value['search']).toBeUndefined();
            expect(parameters.value['order']).toBeUndefined();
        });
    });

    describe('compile order', () => {
        it('applies filters before search', () => {
            const { parameters, setFilter, search } = useListQuery(sharedDefinition);

            setFilter('status', 'active');
            search('alice');

            expect(parsedFilters(parameters.value)).toEqual({ status: 'active' });
            expect(parameters.value['search']).toBe('alice');
        });

        it('applies search before sort (both present in output)', () => {
            const { parameters, search, sortBy } = useListQuery(sharedDefinition);

            search('alice');
            sortBy('createdAt', 'desc');

            expect(parameters.value['order']).toBe('createdAt:desc');
            expect(parameters.value['search']).toBe('alice');
        });

        it('emits limit and page after filters/sort', () => {
            const { parameters } = useListQuery(sharedDefinition);

            expect(parameters.value['limit']).toBe(10);
            expect(parameters.value['page']).toBe(1);
        });
    });

    describe('reactivity', () => {
        it('parameters.value changes after setFilter', () => {
            const { parameters, setFilter } = useListQuery(sharedDefinition);
            const before = parameters.value['filters'];

            setFilter('status', 'active');

            expect(parameters.value['filters']).not.toBe(before);
        });

        it('parameters.value changes after search', () => {
            const { parameters, search } = useListQuery(sharedDefinition);
            const before = parameters.value['search'];

            search('alice');

            expect(parameters.value['search']).not.toBe(before);
        });

        it('parameters.value changes after sortBy', () => {
            const { parameters, sortBy } = useListQuery(sharedDefinition);

            sortBy('age', 'desc');

            expect(parameters.value['order']).toBe('age:desc');
        });

        it('parameters.value changes after goTo', () => {
            const { parameters, goTo } = useListQuery(sharedDefinition);

            goTo(3);

            expect(parameters.value['page']).toBe(3);
        });

        it('parameters.value changes after refine', () => {
            const { parameters, refine } = useListQuery(sharedDefinition);

            refine(q => q.aggregatesFor('users', ['posts_count']));

            expect(parameters.value['aggregates[users]']).toBe('posts_count');
        });

        it('parameters.value changes after reset', () => {
            const { parameters, setFilter, reset } = useListQuery(sharedDefinition);

            setFilter('status', 'active');

            const before = parameters.value['filters'];

            reset();

            expect(parameters.value['filters']).not.toBe(before);
        });
    });

    describe('custom filter', () => {
        it('applies via the escape hatch', () => {
            const definition = defineListQuery({
                filters: {
                    priority: filter.custom<number>((q, value) => q.where('priority', '$ge', value)),
                },
            });
            const { parameters, setFilter } = useListQuery(definition);

            setFilter('priority', 5);

            expect(parsedFilters(parameters.value)).toEqual(wire([['priority', wire([['$ge', 5]])]]));
        });
    });

    describe('pageSize defaults', () => {
        it('defaults to 25 when pageSize is not specified', () => {
            const definition = defineListQuery({ filters: { status: filter.equals('status') } });
            const { parameters } = useListQuery(definition);

            expect(parameters.value['limit']).toBe(25);
        });

        it('uses the explicit pageSize from the definition', () => {
            const definition = defineListQuery({ pageSize: 50 });
            const { parameters } = useListQuery(definition);

            expect(parameters.value['limit']).toBe(50);
        });
    });

    describe('defineListQuery freeze', () => {
        it('returns a frozen object', () => {
            const def = defineListQuery({ pageSize: 20 });

            expect(Object.isFrozen(def)).toBe(true);
        });

        it('frozen definition is still usable by useListQuery', () => {
            const def = defineListQuery({
                filters: { status: filter.equals('status') },
                pageSize: 5,
            });
            const { parameters, setFilter } = useListQuery(def);

            setFilter('status', 'active');

            expect(parsedFilters(parameters.value)).toEqual({ status: 'active' });
            expect(parameters.value['limit']).toBe(5);
        });
    });

    describe('defensive guard branches', () => {
        it('ignores setFilter for a key missing from the definition', () => {
            const definition = defineListQuery({
                filters: { status: filter.equals('status') },
            });
            const { parameters, setFilter } = useListQuery(definition);
            const setFilterUnsafe = setFilter as (name: string, value: unknown) => void;

            setFilterUnsafe('nonExistentKey', 'value');

            expect(parameters.value['filters']).toBeUndefined();
        });

        it('ignores the search term when the definition has no search filter', () => {
            const definition = defineListQuery({
                filters: { status: filter.equals('status') },
            });
            const { parameters, search } = useListQuery(definition);

            search('alice');

            expect(parameters.value['filters']).toBeUndefined();
        });
    });

    describe('filter insertion order', () => {
        it('applies filters in the order they were set', () => {
            const { parameters, setFilter } = useListQuery(sharedDefinition);

            setFilter('status', 'active');
            setFilter('name', 'alice');

            const filters = parsedFilters(parameters.value) as Record<string, unknown>;
            const keys = Object.keys(filters);

            expect(keys.indexOf('status')).toBeLessThan(keys.indexOf('name'));
        });
    });
});
