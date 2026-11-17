/**
 * SSE adapter for the {@link RealtimeConnection} port over native EventSource.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { ExponentialBackoff } from '@sinemacula/foundation/realtime/exponential-backoff';
import type {
    RealtimeConnection,
    RealtimeMessage,
    RealtimeMessageHandler,
    RealtimeState,
    RealtimeStateHandler,
} from '@sinemacula/foundation/realtime/realtime-connection';
import { RealtimeError } from '@sinemacula/foundation/realtime/realtime-error';
import {
    type BeforeReconnectHook,
    runReconnect,
    STABLE_CONNECTION_MS,
} from '@sinemacula/foundation/realtime/reconnect';
import { EventSubscribers, SubscriberList } from '@sinemacula/foundation/realtime/subscribers';

/**
 * Injectable factory for {@link EventSource} instances.
 */
export type EventSourceFactory = (url: string, init: EventSourceInit) => EventSource;

/** Construction options for {@link EventSourceConnection}. */
export interface EventSourceConnectionOptions {
    /** The SSE endpoint, or a builder called on every connect; native EventSource cannot send headers, so put auth tokens in its query string. */
    readonly url: string | (() => string);

    /** Whether the SSE request includes credentials (cookies); defaults to `false`. */
    readonly withCredentials?: boolean;

    /** Backoff strategy for reconnects; defaults to `new ExponentialBackoff({ jitter: 'equal' })`. */
    readonly backoff?: ExponentialBackoff;

    /** Overrides EventSource construction; defaults to the native constructor. */
    readonly eventSourceFactory?: EventSourceFactory;

    /** Awaited before each reconnect, never before a manual `connect()`; pair it with a `url()` builder that reads the fresh token. */
    readonly beforeReconnect?: BeforeReconnectHook;

    /** Receives the errors the connection contains rather than throws: a throwing subscriber or a failed reconnect open. */
    readonly onError?: (error: unknown) => void;
}

/**
 * Whether `event` carries a server-sent frame rather than a transport event;
 * checked structurally so events from another realm or a factory-supplied
 * EventSource still qualify.
 */
function isServerFrame(event: Event): event is MessageEvent {
    return 'data' in event;
}

/**
 * SSE connection that reconnects with backoff whenever the source errors
 * without a `disconnect()`, attaching one listener per subscribed event name to
 * each new EventSource; the backoff resets only once a source stays open for
 * {@link STABLE_CONNECTION_MS}.
 *
 * Every transport error closes the source, whatever its ready state, so each
 * reconnect runs the hook and a fresh `url()`. Native reconnection is given up
 * with it: the `Last-Event-ID` header and the server's `retry:` delay are not
 * carried over, and a server ending the stream for good (such as with a 204)
 * is retried like any other loss. Frames named `open` or `error` are delivered
 * to their subscribers like any other event.
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
    readonly #messages: EventSubscribers<RealtimeMessage> = new EventSubscribers(error => this.#report(error));

    /** Registered connection-state change handlers. */
    readonly #states: SubscriberList<RealtimeState> = new SubscriberList(error => this.#report(error));

    /** Detaches each subscribed event name's listener from the owned source. */
    readonly #listeners: Map<string, () => void> = new Map();

    /** The owned EventSource, or null when there is none. */
    #source: EventSource | null = null;

    /** The current connection lifecycle state. */
    #state: RealtimeState = 'idle';

    /** The current zero-based reconnect attempt counter. */
    #attempt: number = 0;

    /** When the owned source counts as stable, or Infinity until it opens. */
    #stableAt: number = Number.POSITIVE_INFINITY;

    /** The pending reconnect timer, or undefined when none. */
    #reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    /** Aborted by every disconnect, so a superseded reconnect attempt abandons itself. */
    #lifecycle: AbortController = new AbortController();

    constructor(options: EventSourceConnectionOptions) {
        this.#url = options.url;
        this.#withCredentials = options.withCredentials ?? false;
        this.#backoff = options.backoff ?? new ExponentialBackoff({ jitter: 'equal' });
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
     * Open the SSE connection; no-op when already connecting or open.
     *
     * @throws {@link RealtimeError} when the `url()` builder or EventSource
     * factory throws, leaving the state unchanged with the original as cause
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
     * `connect()`, which restarts the backoff. State subscribers see `closed`
     * before the reconnect hook's signal aborts.
     */
    disconnect(): void {
        const previous = this.#lifecycle;

        this.#lifecycle = new AbortController();
        this.#attempt = 0;
        this.#cancelReconnect();
        this.#release()?.close();
        this.#setState('closed');
        previous.abort();
    }

    /**
     * Subscribe to messages for one event name.
     *
     * @returns a function that removes this registration
     */
    on(event: string, handler: RealtimeMessageHandler): () => void {
        const remove = this.#messages.on(event, handler);

        if (this.#source !== null && !this.#listeners.has(event)) {
            this.#attach(this.#source, event);
        }

        return () => {
            remove();

            if (!this.#messages.has(event)) {
                this.#listeners.get(event)?.();
                this.#listeners.delete(event);
            }
        };
    }

    /**
     * Subscribe to connection state changes.
     *
     * @returns a function that removes this registration
     */
    onStateChange(handler: RealtimeStateHandler): () => void {
        return this.#states.add(handler);
    }

    /**
     * Open a fresh EventSource and own it before announcing the connecting
     * state, so a subscriber that disconnects in response closes it. A throwing
     * `url()` builder or factory leaves the state untouched.
     */
    #openSource(): void {
        const url = typeof this.#url === 'function' ? this.#url() : this.#url;
        const source = this.#factory(url, { withCredentials: this.#withCredentials });

        // A server frame named `open` or `error` also reaches these handlers;
        // only the transport's own data-less events drive the lifecycle.
        source.onopen = (event: Event) => {
            if (this.#source === source && !isServerFrame(event)) {
                this.#stableAt = performance.now() + STABLE_CONNECTION_MS;
                this.#setState('open');
            }
        };

        source.onerror = (event: Event) => {
            if (!isServerFrame(event)) {
                this.#lose(source);
            }
        };

        this.#source = source;

        for (const event of this.#messages.events()) {
            this.#attach(source, event);
        }

        this.#setState('connecting');
    }

    /**
     * Release an owned source that errored, close it so only the adapter
     * reconnects, and schedule the reconnect.
     */
    #lose(source: EventSource): void {
        if (this.#source !== source) {
            return;
        }

        if (performance.now() >= this.#stableAt) {
            this.#attempt = 0;
        }

        this.#release();
        source.close();
        this.#scheduleReconnect();
    }

    /**
     * Listen for one event name's frames on `source`, delivering each to the
     * handlers registered when it arrives, until the source is released.
     */
    #attach(source: EventSource, event: string): void {
        /**
         * Deliver a server frame to the event name's current handlers.
         */
        const listener = (frame: Event): void => {
            if (this.#source === source && isServerFrame(frame)) {
                this.#messages.snapshot(event)?.({ event, data: String(frame.data) }, () => this.#source === source);
            }
        };

        source.addEventListener(event, listener);
        this.#listeners.set(event, () => {
            source.removeEventListener(event, listener);
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
            void runReconnect({
                beforeReconnect: this.#beforeReconnect,
                signal: this.#lifecycle.signal,
                reopen: () => this.#openSource(),
                reschedule: () => this.#scheduleReconnect(),
                onError: error => this.#report(error),
            });
        }, delay);

        this.#setState('connecting');
    }

    /**
     * Pass a contained error to the `onError` sink, ignoring a throwing sink so
     * one failure never starves the remaining subscribers.
     */
    #report(error: unknown): void {
        try {
            this.#onError?.(error);
        } catch {
            // The sink is the last resort; nothing is left to report to.
        }
    }

    /**
     * Release ownership of the active source and detach its listeners, so
     * nothing it still delivers is handled.
     *
     * @returns the released source, or null when there was none
     */
    #release(): EventSource | null {
        const source = this.#source;

        this.#source = null;
        this.#stableAt = Number.POSITIVE_INFINITY;

        for (const detach of this.#listeners.values()) {
            detach();
        }

        this.#listeners.clear();

        return source;
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
     */
    #setState(next: RealtimeState): void {
        if (this.#state === next) {
            return;
        }

        this.#state = next;
        this.#states.emit(next);
    }
}
