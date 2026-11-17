/**
 * Unit tests for use-pagination.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import { usePagination } from './use-pagination';

describe('usePagination', () => {
    describe('defaults', () => {
        it('starts on page 1 when no initialPage is given', () => {
            const { page } = usePagination({ total: ref(100) });

            expect(page.value).toBe(1);
        });

        it('uses 25 as the default perPage', () => {
            const { perPage } = usePagination({ total: ref(100) });

            expect(perPage).toBe(25);
        });

        it('respects a custom initialPage', () => {
            const { page } = usePagination({ total: ref(100), initialPage: 3 });

            expect(page.value).toBe(3);
        });

        it('respects a custom perPage', () => {
            const { perPage } = usePagination({ total: ref(100), perPage: 10 });

            expect(perPage).toBe(10);
        });
    });

    describe('pageCount', () => {
        it.each([
            [100, 10],
            [101, 11],
            [0, 1],
            [5, 1],
        ])('splits %i items into %i pages of 10', (total, expected) => {
            const { pageCount } = usePagination({ total: ref(total), perPage: 10 });

            expect(pageCount.value).toBe(expected);
        });

        it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
            'counts one page for the non-finite total %s',
            total => {
                const { page, pageCount, goTo } = usePagination({ total: ref(total), perPage: 10 });

                goTo(5);

                expect(pageCount.value).toBe(1);
                expect(page.value).toBe(1);
            },
        );

        it('stops at the last page a safe offset reaches', () => {
            const { page, pageCount, offset, goTo, next } = usePagination({
                total: ref(Number.MAX_SAFE_INTEGER),
                perPage: 2,
            });

            goTo(Number.MAX_SAFE_INTEGER);
            next();

            expect(pageCount.value).toBe(Math.ceil(Number.MAX_SAFE_INTEGER / 2));
            expect(page.value).toBe(pageCount.value);
            expect(offset.value).toBe(Number.MAX_SAFE_INTEGER - 1);
        });

        it('reacts when total changes', () => {
            const total = ref(100);
            const { pageCount } = usePagination({ total, perPage: 10 });

            expect(pageCount.value).toBe(10);

            total.value = 200;

            expect(pageCount.value).toBe(20);
        });
    });

    describe('hasPrevious', () => {
        it('is false on page 1', () => {
            const { hasPrevious } = usePagination({ total: ref(100) });

            expect(hasPrevious.value).toBe(false);
        });

        it('is true on page 2', () => {
            const { hasPrevious } = usePagination({ total: ref(100), initialPage: 2 });

            expect(hasPrevious.value).toBe(true);
        });
    });

    describe('hasNext', () => {
        it('is true when not on the last page', () => {
            const { hasNext } = usePagination({ total: ref(100), perPage: 10 });

            expect(hasNext.value).toBe(true);
        });

        it('is false on the last page', () => {
            const { hasNext } = usePagination({ total: ref(100), perPage: 10, initialPage: 10 });

            expect(hasNext.value).toBe(false);
        });

        it('is false when total is 0 (only page is 1)', () => {
            const { hasNext } = usePagination({ total: ref(0) });

            expect(hasNext.value).toBe(false);
        });
    });

    describe('offset', () => {
        it('is 0 on page 1', () => {
            const { offset } = usePagination({ total: ref(100), perPage: 10 });

            expect(offset.value).toBe(0);
        });

        it('is perPage on page 2', () => {
            const { offset } = usePagination({ total: ref(100), perPage: 10, initialPage: 2 });

            expect(offset.value).toBe(10);
        });

        it('calculates correctly for arbitrary page and perPage', () => {
            const { offset } = usePagination({ total: ref(1000), perPage: 25, initialPage: 5 });

            expect(offset.value).toBe(100);
        });
    });

    describe('next', () => {
        it('advances to the next page', () => {
            const { page, next } = usePagination({ total: ref(100), perPage: 10 });

            next();

            expect(page.value).toBe(2);
        });

        it('clamps at the last page', () => {
            const { page, next } = usePagination({ total: ref(100), perPage: 10, initialPage: 10 });

            next();

            expect(page.value).toBe(10);
        });
    });

    describe('previous', () => {
        it('moves back to the previous page', () => {
            const { page, previous } = usePagination({ total: ref(100), perPage: 10, initialPage: 3 });

            previous();

            expect(page.value).toBe(2);
        });

        it('clamps at page 1', () => {
            const { page, previous } = usePagination({ total: ref(100), perPage: 10 });

            previous();

            expect(page.value).toBe(1);
        });
    });

    describe('goTo', () => {
        it('navigates to the specified page', () => {
            const { page, goTo } = usePagination({ total: ref(100), perPage: 10 });

            goTo(5);

            expect(page.value).toBe(5);
        });

        it('clamps below 1', () => {
            const { page, goTo } = usePagination({ total: ref(100), perPage: 10 });

            goTo(0);

            expect(page.value).toBe(1);
        });

        it('clamps above pageCount', () => {
            const { page, goTo } = usePagination({ total: ref(100), perPage: 10 });

            goTo(99);

            expect(page.value).toBe(10);
        });

        it('clamps correctly when total shrinks', () => {
            const total = ref(100);
            const { page, goTo } = usePagination({ total, perPage: 10, initialPage: 10 });

            total.value = 30;
            goTo(page.value);

            expect(page.value).toBe(3);
        });

        it.each([
            [2.9, 2],
            [-0.5, 1],
            [10.5, 10],
        ])('truncates goTo(%s) to page %s', (target, expected) => {
            const { page, offset, goTo } = usePagination({ total: ref(100), perPage: 10, initialPage: 4 });

            goTo(target);

            expect(page.value).toBe(expected);
            expect(offset.value).toBe((expected - 1) * 10);
        });

        it.each([Number('abc'), Infinity, -Infinity])('ignores a non-finite goTo(%s)', target => {
            const { page, goTo, next, previous } = usePagination({ total: ref(100), perPage: 10, initialPage: 4 });

            goTo(target);

            expect(page.value).toBe(4);

            next();
            previous();
            previous();

            expect(page.value).toBe(3);
        });
    });

    describe('input validation', () => {
        it.each([
            [2.7, 2],
            [0, 1],
            [Number.NaN, 1],
            [Infinity, 1],
        ])('normalises initialPage %s to %s', (initialPage, expected) => {
            const { page } = usePagination({ total: ref(100), perPage: 10, initialPage });

            expect(page.value).toBe(expected);
        });

        it.each([0, -5, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects perPage %s', perPage => {
            expect(() => usePagination({ total: ref(100), perPage })).toThrow(
                new RangeError(`perPage must be a positive safe integer, received ${perPage}.`),
            );
        });

        it('clamps initialPage to the last page a safe offset reaches', () => {
            const { page, offset } = usePagination({ total: ref(100), perPage: 10, initialPage: 1e20 });

            expect(page.value).toBe(Math.floor(Number.MAX_SAFE_INTEGER / 10) + 1);
            expect(offset.value).toBe(Number.MAX_SAFE_INTEGER - 1);
        });

        it('clamps initialPage to the largest safe page for a single item per page', () => {
            const { page, offset } = usePagination({ total: ref(100), perPage: 1, initialPage: 1e20 });

            expect(page.value).toBe(Number.MAX_SAFE_INTEGER);
            expect(offset.value).toBe(Number.MAX_SAFE_INTEGER - 1);
        });

        it('accepts a single item per page', () => {
            const { pageCount } = usePagination({ total: ref(3), perPage: 1 });

            expect(pageCount.value).toBe(3);
        });
    });
});
