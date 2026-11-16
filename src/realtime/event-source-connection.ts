/**
 * SSE adapter for the {@link RealtimeConnection} port.
 *
 * Wraps the browser's native {@link EventSource} API. Note that native
 * EventSource cannot send custom request headers; the recommended pattern for
 * authenticated streams is to embed the token in the query string via the `url`
 * function form, which is called fresh on every connect so that per-connect
 * credentials are always current.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { ExponentialBackoff } from '@sinemacula/foundation/realtime/exponential-backoff';
import { RealtimeError } from '@sinemacula/foundation/realtime/realtime-error';
import { type BeforeReconnectHook, runReconnect } from '@sinemacula/foundation/realtime/reconnect';
import type {
    RealtimeConnection,
    RealtimeMessageHandler,
    RealtimeState,
    RealtimeStateHandler,
} from '@sinemacula/foundation/realtime/realtime-connection';

/**
 * Injectable factory for {@link EventSource} instances.
 *
 * @param url - the SSE endpoint URL
 * @param init - EventSource initialisation options
 * @returns a new EventSource
 */
export type EventSourceFactory = (url: string, init: EventSourceInit) => EventSource;

/** Construction options for {@link EventSourceConnection}. */
export interface EventSourceConnectionOptions {
    /** The SSE endpoint URL, or a function that returns it. The function form is called on every `connect()`, enabling per-connect auth tokens in the query string - the recommended way to authenticate SSE streams because native EventSource cannot send custom headers. */
    readonly url: string | (() => string);

    /** Pass `true` to include credentials (cookies) in the SSE request. Defaults to `false`. */
    readonly withCredentials?: boolean;

    /** Backoff strategy for reconnects. Defaults to `new ExponentialBackoff()`. */
    readonly backoff?: ExponentialBackoff;

    /** Override the EventSource constructor. Defaults to `(url, init) => new EventSource(url, init)`. */
    readonly eventSourceFactory?: EventSourceFactory;

    /** Awaited before each reconnect, never before a manual `connect()`; pair it with a `url()` builder that reads the fresh token. */
    readonly beforeReconnect?: BeforeReconnectHook;

    /** Receives the errors the connection contains rather than throws: a throwing subscriber or a failed reconnect open. */
    readonly onError?: (error: unknown) => void;
}

/**
 * SSE adapter implementing {@link RealtimeConnection}.
 *
 * Reconnects automatically on error using the provided backoff strategy. All
 * registered event listeners are re-attached to every new EventSource after a
 * reconnect.
 */
export class EventSourceConnection implements RealtimeConnection {
    /** The endpoint URL, or a factory returning it per connect. */
    readonly #url: string | (() => string);

    /** Whether the SSE request includes credentials. */
    readonly #withCredentials: boolean;

    /** The backoff strategy spacing reconnect attempts. */
    readonly #backoff: ExponentialBackoff;

    /** The factory that constructs each EventSource. */
    readonly #factory: EventSourceFactory;

    /** Optional hook awaited before each reconnect. */
    readonly #beforeReconnect: BeforeReconnectHook | undefined;

    /** The optional sink for errors the connection contains. */
    readonly #onError: ((error: unknown) => void) | undefined;

    /** Registered message handlers, keyed by event name. */
    readonly #messageHandlers: Map<string, Set<RealtimeMessageHandler>> = new Map();

    /** Registered connection-state change handlers. */
    readonly #stateHandlers: Set<RealtimeStateHandler> = new Set();

    /** The active EventSource, or null when not open. */
    #source: EventSource | null = null;

    /** The current connection lifecycle state. */
    #state: RealtimeState = 'idle';

    /** The current zero-based reconnect attempt counter. */
    #attempt: number = 0;

    /** The pending reconnect timer, or undefined when none. */
    #reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    /** Advanced on every disconnect so a superseded reconnect attempt abandons itself. */
    #generation: number = 0;

    /**
     * Construct a new SSE connection.
     *
     * @param options - URL, credentials, backoff strategy, optional EventSource
     * factory, reconnect hook and error sink
     */
    constructor(options: EventSourceConnectionOptions) {
        this.#url = options.url;
        this.#withCredentials = options.withCredentials ?? false;
        this.#backoff = options.backoff ?? new ExponentialBackoff();
        this.#factory = options.eventSourceFactory ?? ((url, init) => new EventSource(url, init));
        this.#beforeReconnect = options.beforeReconnect;
        this.#onError = options.onError;
    }

    /**
     * The current connection lifecycle state.
     */
    get state(): RealtimeState {
        return this.#state;
    }

    /**
     * Open the SSE connection. No-op when already connecting or open.
     *
     * @throws {@link RealtimeError} when the `url()` builder or EventSource
     * factory throws; the state is left unchanged and the original error is the
     * cause
     */
    connect(): void {
        if (this.#state === 'connecting' || this.#state === 'open') {
            return;
        }

        try {
            this.#openSource();
        } catch (error) {
            throw new RealtimeError('Cannot connect: the EventSource could not be opened.', { cause: error });
        }
    }

    /**
     * Close the connection and cancel any pending reconnect until the next
     * `connect()`, which restarts the backoff.
     */
    disconnect(): void {
        this.#generation += 1;
        this.#attempt = 0;
        this.#cancelReconnect();
        this.#closeSource();
        this.#setState('closed');
    }

    /**
     * Subscribe to messages for a specific event name.
     *
     * @param event - the event name to subscribe to
     * @param handler - called for each matching incoming message
     * @returns an unsubscribe function
     */
    on(event: string, handler: RealtimeMessageHandler): () => void {
        let handlers = this.#messageHandlers.get(event);

        if (handlers === undefined) {
            handlers = new Set();
            this.#messageHandlers.set(event, handlers);

            if (this.#source !== null) {
                this.#attachEventListener(this.#source, event, handlers);
            }
        }

        handlers.add(handler);

        return () => {
            handlers.delete(handler);
        };
    }

    /**
     * Subscribe to connection state changes.
     *
     * @param handler - called each time the state transitions
     * @returns an unsubscribe function
     */
    onStateChange(handler: RealtimeStateHandler): () => void {
        this.#stateHandlers.add(handler);

        return () => {
            this.#stateHandlers.delete(handler);
        };
    }

    /**
     * Open a fresh EventSource and own it before announcing the connecting
     * state, so a subscriber that disconnects in response closes it. A throwing
     * `url()` builder or factory leaves the state untouched.
     */
    #openSource(): void {
        const url = typeof this.#url === 'function' ? this.#url() : this.#url;
        const source = this.#factory(url, { withCredentials: this.#withCredentials });

        source.onopen = () => {
            if (this.#source === source) {
                this.#attempt = 0;
                this.#setState('open');
            }
        };

        // Native EventSource retries on its own; closing it hands reconnects to
        // the backoff and the beforeReconnect hook.
        source.onerror = () => {
            if (this.#source === source) {
                this.#closeSource();
                this.#scheduleReconnect();
            }
        };

        for (const [event, handlers] of this.#messageHandlers) {
            this.#attachEventListener(source, event, handlers);
        }

        this.#source = source;
        this.#setState('connecting');
    }

    /**
     * Attach a listener for one event name that fans frames out to its handlers
     * while `source` is still the active EventSource.
     *
     * @param source - the EventSource to attach the listener to
     * @param event - the event name to listen for
     * @param handlers - the live handler set registered for `event`
     */
    #attachEventListener(source: EventSource, event: string, handlers: Set<RealtimeMessageHandler>): void {
        source.addEventListener(event, (messageEvent: MessageEvent) => {
            if (this.#source !== source) {
                return;
            }

            const message = { event, data: String(messageEvent.data) };

            for (const handler of handlers) {
                try {
                    handler(message);
                } catch (error) {
                    this.#report(error);
                }
            }
        });
    }

    /**
     * Schedule the next reconnect after the backoff delay for the current
     * attempt, then enter the connecting state. The timer is stored first so a
     * subscriber that disconnects in response cancels it.
     */
    #scheduleReconnect(): void {
        const delay = this.#backoff.delayFor(this.#attempt++);

        this.#reconnectTimer = setTimeout(() => {
            this.#reconnectTimer = undefined;
            void this.#runReconnect();
        }, delay);

        this.#setState('connecting');
    }

    /**
     * Run one reconnect attempt, abandoning it if a disconnect lands first.
     */
    async #runReconnect(): Promise<void> {
        const generation = this.#generation;

        await runReconnect({
            beforeReconnect: this.#beforeReconnect,
            isStale: () => this.#generation > generation,
            reopen: () => this.#openSource(),
            reschedule: () => this.#scheduleReconnect(),
            onError: error => this.#report(error),
        });
    }

    /**
     * Pass a contained error to the `onError` sink, ignoring a throwing sink so
     * one failure never starves the remaining subscribers.
     *
     * @param error - the contained error
     */
    #report(error: unknown): void {
        try {
            this.#onError?.(error);
        } catch {
            // The sink is the last resort; nothing is left to report to.
        }
    }

    /**
     * Release the active EventSource and close it. Ownership goes first, so its
     * listeners ignore anything it still delivers.
     */
    #closeSource(): void {
        const source = this.#source;

        this.#source = null;
        source?.close();
    }

    /**
     * Cancel any pending reconnect timer.
     */
    #cancelReconnect(): void {
        clearTimeout(this.#reconnectTimer);
        this.#reconnectTimer = undefined;
    }

    /**
     * Transition to `next`, notifying state subscribers only on a real change.
     *
     * @param next - the state to transition to
     */
    #setState(next: RealtimeState): void {
        if (this.#state === next) {
            return;
        }

        this.#state = next;

        for (const handler of this.#stateHandlers) {
            try {
                handler(next);
            } catch (error) {
                this.#report(error);
            }
        }
    }
}
