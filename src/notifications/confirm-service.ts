/**
 * Confirmation dialog state; requests queue FIFO and surface one at a time.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ComputedRef } from 'vue';
import { computed, ref } from 'vue';

import type { ConfirmRequest, Confirmer } from '@sinemacula/foundation/notifications/confirmer';

/**
 * A {@link ConfirmRequest} currently awaiting the user's answer.
 */
export interface ActiveConfirm extends ConfirmRequest {
    /** The unique id assigned when the request became active. */
    readonly id: string;
}

interface PendingEntry {
    /** The confirmation content awaiting display. */
    readonly request: ConfirmRequest;

    /** Settles the associated `confirm` promise with the outcome. */
    readonly resolve: (outcome: boolean) => void;
}

/**
 * Reactive confirmation queue, rendered by one app-wide host component that
 * reads {@link active}; the service never touches the DOM.
 */
export class ConfirmService implements Confirmer {
    /** Pending confirmations awaiting their turn, in FIFO order. */
    readonly #queue: PendingEntry[] = [];

    /** The reactive currently-active confirmation, or null. */
    readonly #active = ref<ActiveConfirm | null>(null);

    /** Monotonic counter backing generated confirmation ids. */
    #sequence = 0;

    /** Resolver for the active confirmation's promise, or null. */
    #currentResolve: ((outcome: boolean) => void) | null = null;

    /** The reactive, read-only currently-active confirmation request. */
    readonly active: ComputedRef<ActiveConfirm | null>;

    constructor() {
        this.active = computed(() => this.#active.value);
    }

    /**
     * Request a user confirmation, queued behind any active one.
     *
     * @returns resolves `true` when the user confirms, `false` when cancelled
     */
    confirm(request: ConfirmRequest): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            if (this.#active.value === null) {
                this.#surface({ request, resolve });
            } else {
                this.#queue.push({ request, resolve });
            }
        });
    }

    /**
     * Resolve the active request with the outcome and surface the next queued
     * one; no-op when none is active.
     */
    settle(outcome: boolean): void {
        if (this.#active.value === null || this.#currentResolve === null) {
            return;
        }

        const resolve = this.#currentResolve;

        this.#active.value = null;
        this.#currentResolve = null;

        resolve(outcome);

        const next = this.#queue.shift();

        if (next !== undefined) {
            this.#surface(next);
        }
    }

    /**
     * Make an entry the active confirmation request.
     */
    #surface(entry: PendingEntry): void {
        const id = `confirm-${++this.#sequence}`;

        this.#currentResolve = entry.resolve;
        this.#active.value = { ...entry.request, id };
    }
}
