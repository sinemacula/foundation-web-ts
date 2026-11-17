/**
 * Reactive pagination state; callers re-clamp via `goTo` when `total` shrinks.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ComputedRef, Ref } from 'vue';
import { computed, ref } from 'vue';

/**
 * Options accepted by {@link usePagination}.
 */
export interface UsePaginationOptions {
    /** Reactive total item count the page bounds are derived from; a non-finite total counts as none. */
    readonly total: Ref<number>;

    /** Items shown per page, a positive safe integer; defaults to 25. */
    readonly perPage?: number;

    /** Page to start on, truncated to an integer and clamped to the pages a safe offset reaches; defaults to the first page. */
    readonly initialPage?: number;
}

/**
 * The reactive pagination state returned by {@link usePagination}.
 */
export interface Pagination {
    /** The current page, counting from one; the navigation methods keep it in range, a direct write is not checked. */
    readonly page: Ref<number>;

    /** The resolved number of items per page. */
    readonly perPage: number;

    /** The total number of pages, at least one and no more than a safe offset reaches. */
    readonly pageCount: ComputedRef<number>;

    /** Whether a page exists before the current one. */
    readonly hasPrevious: ComputedRef<boolean>;

    /** Whether a page exists after the current one. */
    readonly hasNext: ComputedRef<boolean>;

    /** The zero-based index of the first item on the current page. */
    readonly offset: ComputedRef<number>;

    /**
     * Advance one page, stopping at the last.
     */
    next(): void;

    /**
     * Step back one page, stopping at the first.
     */
    previous(): void;

    /**
     * Jump to a page, truncated to an integer and clamped into
     * `[1, pageCount]`; a non-finite page is ignored.
     */
    goTo(page: number): void;
}

const DEFAULT_PER_PAGE = 25;

/**
 * Create reactive pagination state for a data set with a known total. Pages
 * stop where the offset of the next would exceed the largest safe integer.
 *
 * @throws {RangeError} when `perPage` is not a positive safe integer
 */
export function usePagination(options: UsePaginationOptions): Pagination {
    const perPage = options.perPage ?? DEFAULT_PER_PAGE;

    if (!Number.isSafeInteger(perPage) || perPage < 1) {
        throw new RangeError(`perPage must be a positive safe integer, received ${perPage}.`);
    }

    const maxPage = Math.floor(Number.MAX_SAFE_INTEGER / perPage);
    const initialPage = options.initialPage ?? 1;
    const page = ref(Number.isFinite(initialPage) ? Math.min(Math.max(1, Math.trunc(initialPage)), maxPage) : 1);

    const pageCount = computed(() => {
        const total = Number.isFinite(options.total.value) ? options.total.value : 0;

        return Math.min(Math.max(1, Math.ceil(total / perPage)), maxPage);
    });
    const hasPrevious = computed(() => page.value > 1);
    const hasNext = computed(() => page.value < pageCount.value);
    const offset = computed(() => (page.value - 1) * perPage);

    /**
     * Jump to a page, truncated and clamped into `[1, pageCount]`; a non-finite
     * page is ignored.
     */
    function goTo(target: number): void {
        if (Number.isFinite(target)) {
            page.value = Math.min(Math.max(1, Math.trunc(target)), pageCount.value);
        }
    }

    /**
     * Advance one page, stopping at the last.
     */
    function next(): void {
        goTo(page.value + 1);
    }

    /**
     * Step back one page, stopping at the first.
     */
    function previous(): void {
        goTo(page.value - 1);
    }

    return { page, perPage, pageCount, hasPrevious, hasNext, offset, next, previous, goTo };
}
