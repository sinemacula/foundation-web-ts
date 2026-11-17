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
    /** Reactive total item count the page bounds are derived from. */
    readonly total: Ref<number>;

    /** Items shown per page; defaults to 25. */
    readonly perPage?: number;

    /** Page to start on; defaults to the first page. */
    readonly initialPage?: number;
}

/**
 * The reactive pagination state returned by {@link usePagination}.
 */
export interface Pagination {
    /** The current page, counting from one. */
    readonly page: Ref<number>;

    /** The resolved number of items per page. */
    readonly perPage: number;

    /** The total number of pages, always at least one. */
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
     * Jump to a page, clamped into `[1, pageCount]`.
     */
    goTo(page: number): void;
}

const DEFAULT_PER_PAGE = 25;

/**
 * Create reactive pagination state for a data set with a known total.
 */
export function usePagination(options: UsePaginationOptions): Pagination {
    const perPage = options.perPage ?? DEFAULT_PER_PAGE;
    const page = ref(options.initialPage ?? 1);

    const pageCount = computed(() => Math.max(1, Math.ceil(options.total.value / perPage)));
    const hasPrevious = computed(() => page.value > 1);
    const hasNext = computed(() => page.value < pageCount.value);
    const offset = computed(() => (page.value - 1) * perPage);

    /**
     * Jump to a page, clamped into `[1, pageCount]`.
     */
    function goTo(target: number): void {
        page.value = Math.min(Math.max(1, target), pageCount.value);
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
