/**
 * Request-state composable that runs a fetcher and tracks its lifecycle.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ComputedRef, Ref, WatchSource } from 'vue';
import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue';

/**
 * Executes a single run of a request, given the `AbortSignal` for that run.
 *
 * Forward the signal to the transport (e.g. `HttpClient`'s `signal` option) so
 * superseded or stopped runs are cancelled at the network layer.
 */
export type ResourceFetcher<Value> = (signal: AbortSignal) => Promise<Value>;

/**
 * Options accepted by {@link useResource}.
 */
export interface UseResourceOptions<Value> {
    /** Executes a single run of the request. */
    readonly fetcher: ResourceFetcher<Value>;

    /** Reactive source(s) that trigger a refetch on change, e.g. a `useListQuery` `parameters` ref. */
    readonly watch?: WatchSource<unknown> | ReadonlyArray<WatchSource<unknown>>;

    /** Whether to run the fetcher on creation; defaults to true. */
    readonly immediate?: boolean;
}

/**
 * The reactive request-state returned by {@link useResource}.
 */
export interface Resource<Value> {
    /** The most recently resolved value, or `null` before the first success. */
    readonly data: Ref<Value | null>;

    /** Whatever the fetcher threw on its most recent run, or `null` when none. */
    readonly error: Ref<unknown>;

    /** `true` while the latest run is in flight. */
    readonly isLoading: Ref<boolean>;

    /** `true` once a run has resolved successfully at least once. */
    readonly hasLoaded: ComputedRef<boolean>;

    /**
     * Run the fetcher again, superseding any run already in flight; settles
     * once this run has settled.
     */
    refetch(): Promise<void>;

    /**
     * Abort any in-flight run, discard its outcome and stop reacting to the
     * watch source(s); later {@link refetch} calls do nothing.
     */
    stop(): void;
}

/**
 * Execute a {@link ResourceFetcher} and expose its lifecycle as reactive state.
 *
 * Each run aborts the previous one, and results from superseded runs are
 * discarded even when the fetcher ignores the signal. `error` resets at the
 * start of each run, `data` keeps the stale value while a reload is in flight,
 * and a rejection caused by the run's own abort is not reported as an error.
 * Stops automatically when the enclosing effect scope is disposed.
 */
export function useResource<Value>(options: UseResourceOptions<Value>): Resource<Value> {
    const { fetcher, watch: watchSource, immediate = true } = options;

    // `ref` cannot infer `Value | null` from a bare generic parameter.
    const data = ref(null) as Ref<Value | null>;
    const error = ref<unknown>(null);
    const isLoading = ref(false);
    const resolvedOnce = ref(false);

    const { run, halt } = createRunner(fetcher, { data, error, isLoading, resolvedOnce });

    /**
     * Run the fetcher again, superseding any run already in flight.
     */
    async function refetch(): Promise<void> {
        await run();
    }

    let stopWatch: (() => void) | null = null;

    /**
     * Abort and discard any in-flight run and stop reacting to the watch
     * source(s).
     */
    function stop(): void {
        halt();
        stopWatch?.();
    }

    if (watchSource !== undefined) {
        const sources: ReadonlyArray<WatchSource<unknown>> = Array.isArray(watchSource) ? watchSource : [watchSource];

        stopWatch = watch(sources, () => {
            void run();
        });
    }

    if (immediate) {
        void run();
    }

    if (getCurrentScope() !== undefined) {
        onScopeDispose(stop);
    }

    return {
        data,
        error,
        isLoading,
        hasLoaded: computed(() => resolvedOnce.value),
        refetch,
        stop,
    };
}

/**
 * The reactive fields a runner settles as a request progresses.
 */
interface ResourceState<Value> {
    /** The most recently resolved value, or null before the first success. */
    readonly data: Ref<Value | null>;

    /** Whatever the fetcher last threw, or null when none. */
    readonly error: Ref<unknown>;

    /** Whether the latest run is in flight. */
    readonly isLoading: Ref<boolean>;

    /** Whether a run has resolved successfully at least once. */
    readonly resolvedOnce: Ref<boolean>;
}

/**
 * The run trigger and halt control returned by {@link createRunner}.
 */
interface Runner {
    /** Trigger a run, superseding any run already in flight. */
    run: () => Promise<void>;

    /** Abort and discard the in-flight run and refuse every later run. */
    halt: () => void;
}

/**
 * Drive sequential runs of a fetcher, settling `state` for the latest run only.
 */
function createRunner<Value>(fetcher: ResourceFetcher<Value>, state: ResourceState<Value>): Runner {
    let activeController: AbortController | null = null;
    let stopped = false;

    /**
     * Execute one run, discarding its outcome when a newer run supersedes it.
     */
    async function run(): Promise<void> {
        if (stopped) {
            return;
        }

        const previous = activeController;
        const controller = new AbortController();

        activeController = controller;
        previous?.abort();

        // An abort listener on the previous run may have stopped or rerun this.
        if (controller.signal.aborted) {
            return;
        }

        state.error.value = null;
        state.isLoading.value = true;

        try {
            const result = await fetcher(controller.signal);

            if (controller.signal.aborted) {
                return;
            }

            state.data.value = result;
            state.resolvedOnce.value = true;
        } catch (caught) {
            if (controller.signal.aborted) {
                return;
            }

            state.error.value = caught;
        } finally {
            if (activeController === controller) {
                state.isLoading.value = false;
            }
        }
    }

    /**
     * Abort and discard the in-flight run and refuse every later run.
     */
    function halt(): void {
        stopped = true;
        activeController?.abort();
        state.isLoading.value = false;
    }

    return { run, halt };
}
