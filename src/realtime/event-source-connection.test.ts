/**
 * Unit tests for event-source-connection.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventSourceConnection, type EventSourceFactory } from './event-source-connection';
import { describeRealtimeContract, type RealtimeContractHarness } from './test-support/realtime-connection-contract';

/** Minimal fake EventSource for injection via the factory. */
class FakeEventSource {
    /** The URL the adapter opened this source with. */
    readonly url: string;

    /** The credentials flag the adapter passed in the init options. */
    readonly withCredentials: boolean;

    /** The open handler the adapter assigns; fired by emitOpen(). */
    onopen: ((event: Event) => void) | null = null;

    /** The error handler the adapter assigns; fired by emitError(). */
    onerror: ((event: Event) => void) | null = null;

    /** The listeners the adapter registered, keyed by event type. */
    readonly #listeners: Map<string, Array<(event: MessageEvent) => void>> = new Map();

    /** Whether close() has been called on this source. */
    #closed: boolean = false;

    /** The number of times the adapter called close(). */
    closeCalls: number = 0;

    constructor(url: string, init: EventSourceInit) {
        this.url = url;
        this.withCredentials = init.withCredentials ?? false;
    }

    /**
     * Record a listener so emitMessage() can deliver events of the given type.
     */
    addEventListener(type: string, listener: (event: MessageEvent) => void): void {
        let list = this.#listeners.get(type);

        if (list === undefined) {
            list = [];
            this.#listeners.set(type, list);
        }

        list.push(listener);
    }

    /**
     * Mark the source closed and count the call.
     */
    close(): void {
        this.#closed = true;
        this.closeCalls++;
    }

    /**
     * Whether the adapter has closed this source.
     */
    get closed(): boolean {
        return this.#closed;
    }

    /**
     * Simulate the server accepting the stream.
     */
    emitOpen(): void {
        this.onopen?.(new Event('open'));
    }

    /**
     * Simulate a stream error, which drives the adapter's reconnect path.
     */
    emitError(): void {
        this.onerror?.(new Event('error'));
    }

    /**
     * Deliver a message event with the given data to each listener for the
     * type.
     */
    emitMessage(type: string, data: unknown): void {
        const listeners = this.#listeners.get(type) ?? [];
        const event = new MessageEvent(type, { data });

        for (const listener of listeners) {
            listener(event);
        }
    }
}

/** A factory to inject into the adapter and the fakes it has created so far. */
interface RecordingFactory {
    /** Every fake the factory has created, in creation order. */
    sources: FakeEventSource[];

    /** The factory passed to the adapter as `eventSourceFactory`. */
    factory: EventSourceFactory;
}

/**
 * Creates a typed {@link EventSourceFactory} that records each fake it creates.
 * The cast to `EventSource` is confined to a single line inside the closure so
 * every test body can use the strongly-typed {@link FakeEventSource} directly.
 */
function makeFactory(): RecordingFactory {
    const sources: FakeEventSource[] = [];

    /** Build a fake source and record it before handing it to the adapter. */
    const factory: EventSourceFactory = (url, init) => {
        const source = new FakeEventSource(url, init);

        sources.push(source);

        return source as unknown as EventSource;
    };

    return { sources, factory };
}

/** Adapts the SSE adapter and its fake to the shared realtime contract. */
function makeSseContractHarness(): RealtimeContractHarness {
    return {
        create(options) {
            const { sources, factory } = makeFactory();
            const connection = new EventSourceConnection({ ...options, eventSourceFactory: factory });

            return {
                connection,
                transports: {
                    get length() {
                        return sources.length;
                    },
                    at(index) {
                        const source = sources.at(index);

                        if (source === undefined) {
                            return undefined;
                        }

                        return {
                            get url() {
                                return source.url;
                            },
                            get closeCalls() {
                                return source.closeCalls;
                            },
                            open: () => source.emitOpen(),
                            fail: () => source.emitError(),
                            message: (event, data) => source.emitMessage(event, data),
                        };
                    },
                },
            };
        },
    };
}

describeRealtimeContract(makeSseContractHarness());

describe('EventSourceConnection', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('connect()', () => {
        it('passes withCredentials to the factory', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({
                url: 'http://sse',
                withCredentials: true,
                eventSourceFactory: factory,
            });

            conn.connect();

            const source = sources.at(0);

            expect(source).toBeDefined();
            expect(source?.withCredentials).toBe(true);
        });

        it('defaults withCredentials to false', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });

            conn.connect();

            const source = sources.at(0);

            expect(source).toBeDefined();
            expect(source?.withCredentials).toBe(false);
        });

        it('exercises the default EventSource factory when no factory is injected', () => {
            // happy-dom does not ship an EventSource stub, so we install a
            // minimal constructible shim on globalThis to exercise the default
            // factory path.
            const globals = globalThis as Record<string, unknown>;
            const OriginalEventSource = globals['EventSource'];

            /** Constructible stand-in installed as the global EventSource. */
            class FakeEventSourceShim extends FakeEventSource {}

            globals['EventSource'] = FakeEventSourceShim;

            try {
                const conn = new EventSourceConnection({ url: 'http://localhost/sse' });

                expect(() => conn.connect()).not.toThrow();
            } finally {
                globals['EventSource'] = OriginalEventSource;
            }
        });
    });

    describe('on()', () => {
        it('coerces data to a string', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });

            const received: string[] = [];

            conn.on('tick', msg => received.push(msg.data));
            conn.connect();
            sources.at(0)?.emitMessage('tick', 42);

            expect(received).toEqual(['42']);
        });

        it('attaches addEventListener when registered after connect', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });

            conn.connect();

            const received: string[] = [];

            conn.on('late', msg => received.push(msg.data));
            sources.at(0)?.emitMessage('late', 'hi');

            expect(received).toEqual(['hi']);
        });
    });
});
