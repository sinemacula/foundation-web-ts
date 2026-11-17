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

    /** The active confirmation's id and the resolver for its promise, or null. */
    #current: { readonly id: string; readonly resolve: (outcome: boolean) => void } | null = null;

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
            if (this.#current === null) {
                this.#surface({ request, resolve });
            } else {
                this.#queue.push({ request, resolve });
            }
        });
    }

    /**
     * Resolve the active request with the outcome and surface the next queued
     * one; no-op when none is active or when `id` names a request that is no
     * longer active, so a stale or repeated answer never reaches the next one.
     */
    settle(outcome: boolean, id?: string): void {
        const current = this.#current;

        if (current === null || (id !== undefined && id !== current.id)) {
            return;
        }

        this.#current = null;
        this.#active.value = null;

        current.resolve(outcome);

        const next = this.#queue.shift();

        if (next !== undefined) {
            this.#surface(next);
        }
    }

    /**
     * Cancel the active request and every queued one, resolving each `false`.
     */
    cancelAll(): void {
        const pending = this.#queue.splice(0);
        const current = this.#current;

        this.#current = null;
        this.#active.value = null;

        current?.resolve(false);

        for (const entry of pending) {
            entry.resolve(false);
        }
    }

    /**
     * Make an entry the active confirmation request.
     */
    #surface(entry: PendingEntry): void {
        const id = `confirm-${++this.#sequence}`;

        this.#current = { id, resolve: entry.resolve };
        this.#active.value = { ...entry.request, id };
    }
}
