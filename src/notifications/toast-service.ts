/**
 * Toast notification state and auto-dismiss lifecycle.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ComputedRef } from 'vue';
import { computed, ref } from 'vue';

import type { ShowToastOptions, Toaster } from '@sinemacula/foundation/notifications/toaster';

/** The visual emphasis of a toast notification. */
export type ToastVariant = 'success' | 'error' | 'information' | 'warning';

/**
 * A single toast notification; the rendering host translates its message.
 */
export interface Toast {
    /** The unique id assigned when the toast was shown. */
    readonly id: string;

    /** The visual emphasis of the toast. */
    readonly variant: ToastVariant;

    /** The message, by convention a translation key. */
    readonly message: string;

    /** Milliseconds before auto-dismiss; 0 disables it. */
    readonly duration: number;
}

const DEFAULT_DURATION = 5_000;

/**
 * Reactive toast list, rendered by one app-wide host component that reads
 * {@link toasts}; the service never touches the DOM.
 */
export class ToastService implements Toaster {
    /** Fallback auto-dismiss duration in milliseconds. */
    readonly #defaultDuration: number;

    /** The reactive list of currently visible toasts. */
    readonly #list = ref<Toast[]>([]);

    /** Pending auto-dismiss timers, keyed by toast id. */
    readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

    /** Monotonic counter backing generated toast ids. */
    #sequence = 0;

    /** The reactive, read-only list of currently visible toasts. */
    readonly toasts: ComputedRef<readonly Toast[]>;

    constructor(defaultDuration: number = DEFAULT_DURATION) {
        this.#defaultDuration = defaultDuration;
        this.toasts = computed(() => this.#list.value);
    }

    /**
     * Show a toast, auto-dismissed after its duration unless that is 0.
     *
     * @returns the new toast's id
     */
    show(variant: ToastVariant, message: string, options?: ShowToastOptions): string {
        const id = `toast-${++this.#sequence}`;
        const duration = options?.duration ?? this.#defaultDuration;

        this.#list.value = [...this.#list.value, { id, variant, message, duration }];

        if (duration > 0) {
            this.#timers.set(
                id,
                setTimeout(() => {
                    this.dismiss(id);
                }, duration),
            );
        }

        return id;
    }

    /**
     * Show a success toast.
     *
     * @returns the new toast's id
     */
    success(message: string, options?: ShowToastOptions): string {
        return this.show('success', message, options);
    }

    /**
     * Show an error toast.
     *
     * @returns the new toast's id
     */
    error(message: string, options?: ShowToastOptions): string {
        return this.show('error', message, options);
    }

    /**
     * Show an information toast.
     *
     * @returns the new toast's id
     */
    information(message: string, options?: ShowToastOptions): string {
        return this.show('information', message, options);
    }

    /**
     * Show a warning toast.
     *
     * @returns the new toast's id
     */
    warning(message: string, options?: ShowToastOptions): string {
        return this.show('warning', message, options);
    }

    /**
     * Dismiss a toast and cancel its auto-dismiss timer; no-op for unknown ids.
     */
    dismiss(id: string): void {
        const timer = this.#timers.get(id);

        if (timer !== undefined) {
            clearTimeout(timer);
            this.#timers.delete(id);
        }

        this.#list.value = this.#list.value.filter(toast => toast.id !== id);
    }

    /**
     * Remove all toasts and cancel all pending auto-dismiss timers.
     */
    clear(): void {
        for (const timer of this.#timers.values()) {
            clearTimeout(timer);
        }

        this.#timers.clear();
        this.#list.value = [];
    }
}
