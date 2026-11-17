/**
 * Unit tests for event-source-connection.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { ExponentialBackoff } from '@sinemacula/foundation/realtime/exponential-backoff';
import { RealtimeError } from '@sinemacula/foundation/realtime/realtime-error';
import {
    describeRealtimeContract,
    type RealtimeContractHarness,
} from '@sinemacula/foundation/realtime/test-support/realtime-connection-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventSourceConnection, type EventSourceFactory } from './event-source-connection';

/** Minimal fake EventSource for injection via the factory. */
class FakeEventSource {
    /** The URL the source was opened with. */
    readonly url: string;

    /** Whether the source was opened with credentials. */
    readonly withCredentials: boolean;

    /** The open handler the connection installs. */
    onopen: ((event: Event) => void) | null = null;

    /** The error handler the connection installs. */
    onerror: ((event: Event) => void) | null = null;

    /** How many times close() was called. */
    closeCalls: number = 0;

    /** The ready state the source reports. */
    readyState: number = 0;

    /** The listeners registered per event name. */
    readonly #listeners: Map<string, Array<(event: MessageEvent) => void>> = new Map();

    /**
     * Record the construction arguments.
     */
    constructor(url: string, init: EventSourceInit) {
        this.url = url;
        this.withCredentials = init.withCredentials ?? false;
    }

    /**
     * Register a listener for a named event.
     */
    addEventListener(type: string, listener: (event: MessageEvent) => void): void {
        const listeners = this.#listeners.get(type) ?? [];

        listeners.push(listener);
        this.#listeners.set(type, listeners);
    }

    /**
     * Unregister a listener for a named event.
     */
    removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
        this.#listeners.set(
            type,
            (this.#listeners.get(type) ?? []).filter(registered => registered !== listener),
        );
    }

    /**
     * Count the listeners registered for a named event.
     */
    listenerCount(type: string): number {
        return this.#listeners.get(type)?.length ?? 0;
    }

    /**
     * Record a close call.
     */
    close(): void {
        this.closeCalls++;
    }

    /**
     * Simulate the source opening, reaching the handler property and then any
     * `open` listeners as the native source does.
     */
    emitOpen(): void {
        this.#dispatchTransportEvent('open', this.onopen);
    }

    /**
     * Simulate the source failing, reaching the handler property and then any
     * `error` listeners as the native source does.
     */
    emitError(): void {
        this.#dispatchTransportEvent('error', this.onerror);
    }

    /**
     * Simulate the source failing in the given ready state.
     */
    fail(readyState: number): void {
        this.readyState = readyState;
        this.emitError();
    }

    /**
     * Dispatch a data-less transport event to its handler property and
     * listeners.
     */
    #dispatchTransportEvent(type: string, handler: ((event: Event) => void) | null): void {
        const event = new Event(type);

        handler?.(event);

        for (const listener of this.#listeners.get(type) ?? []) {
            listener(event as MessageEvent);
        }
    }

    /**
     * Simulate an incoming named event; like the native source, a frame named
     * `open` or `error` also reaches the matching handler property first.
     */
    emitMessage(type: string, data: unknown): void {
        const event = new MessageEvent(type, { data });

        if (type === 'open') {
            this.onopen?.(event);
        } else if (type === 'error') {
            this.onerror?.(event);
        }

        for (const listener of this.#listeners.get(type) ?? []) {
            listener(event);
        }
    }
}

/** A recording factory and the fakes it has created so far. */
interface RecordingFactory {
    /** Every fake source created, in order. */
    readonly sources: FakeEventSource[];

    /** The factory to inject into the connection. */
    readonly factory: EventSourceFactory;

    /** While set, the factory throws this error instead of creating a source. */
    failure: Error | null;
}

/**
 * Create an {@link EventSourceFactory} that records each fake it creates,
 * keeping the `EventSource` cast out of the test bodies.
 */
function makeFactory(): RecordingFactory {
    const recording: RecordingFactory = {
        sources: [],
        factory: (url, init) => {
            if (recording.failure !== null) {
                throw recording.failure;
            }

            const source = new FakeEventSource(url, init);

            recording.sources.push(source);

            return source as unknown as EventSource;
        },
        failure: null,
    };

    return recording;
}

/**
 * Fixed-delay backoff for deterministic reconnect assertions.
 */
function fixedBackoff(delay: number): ExponentialBackoff {
    return new ExponentialBackoff({ initialDelay: delay, multiplier: 1, maxDelay: delay });
}

/**
 * Adapt the SSE adapter and its fake to the shared realtime contract.
 */
function makeSseContractHarness(): RealtimeContractHarness {
    return {
        create(options) {
            const recording = makeFactory();
            const { sources } = recording;
            const connection = new EventSourceConnection({ ...options, eventSourceFactory: recording.factory });

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
                setFactoryError: error => {
                    recording.failure = error;
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
        vi.unstubAllGlobals();
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

            expect(sources.at(0)?.withCredentials).toBe(true);
        });

        it('wraps a throwing EventSource factory in a RealtimeError', () => {
            const recording = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: recording.factory });

            recording.failure = new Error('factory failed');

            expect(() => conn.connect()).toThrowError(
                new RealtimeError('Cannot connect: the EventSource could not be opened.'),
            );
        });

        it('defaults withCredentials to false', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });

            conn.connect();

            expect(sources.at(0)?.withCredentials).toBe(false);
        });

        it('constructs the platform EventSource when no factory is injected', () => {
            const calls: unknown[][] = [];

            /** Stand-in EventSource that records its construction arguments. */
            class RecordingEventSource {
                /**
                 * Record the construction arguments.
                 */
                constructor(...args: unknown[]) {
                    calls.push(args);
                }
            }

            vi.stubGlobal('EventSource', RecordingEventSource);

            new EventSourceConnection({ url: 'http://localhost/sse' }).connect();

            expect(calls).toEqual([['http://localhost/sse', { withCredentials: false }]]);
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

        it('attaches one listener per event when subscribing after connect', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });

            const received: string[] = [];

            conn.connect();
            conn.on('late', msg => received.push(`a:${msg.data}`));
            conn.on('late', msg => received.push(`b:${msg.data}`));
            sources.at(0)?.emitMessage('late', 'hi');

            expect(received).toEqual(['a:hi', 'b:hi']);
        });
    });

    describe('server frames named after lifecycle events', () => {
        it('delivers an error frame to subscribers without reconnecting', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });
            const received: string[] = [];

            conn.on('error', msg => received.push(msg.data));
            conn.connect();
            sources.at(0)?.emitOpen();
            sources.at(0)?.emitMessage('error', 'quota exceeded');

            expect(received).toEqual(['quota exceeded']);
            expect(conn.state).toBe('open');
            expect(sources.at(0)?.closeCalls).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('delivers an open frame to subscribers without touching the state', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });
            const received: string[] = [];

            conn.on('open', msg => received.push(msg.data));
            conn.connect();
            sources.at(0)?.emitMessage('open', 'early');

            expect(received).toEqual(['early']);
            expect(conn.state).toBe('connecting');
        });

        it('keeps a transport failure away from error subscribers', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });
            const received: string[] = [];

            conn.on('error', msg => received.push(msg.data));
            conn.connect();
            conn.on('later', () => undefined);
            sources.at(0)?.emitError();

            expect(received).toEqual([]);
            expect(sources.at(0)?.closeCalls).toBe(1);
            expect(conn.state).toBe('connecting');
        });

        it('keeps the connection opening away from open subscribers', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });
            const received: string[] = [];

            conn.on('open', msg => received.push(msg.data));
            conn.connect();
            sources.at(0)?.emitOpen();

            expect(received).toEqual([]);
            expect(conn.state).toBe('open');
        });
    });

    describe('subscription churn', () => {
        it('detaches an event name from the live source once its last handler leaves', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });

            conn.connect();

            for (let round = 0; round < 50; round++) {
                const first = conn.on(`event-${round}`, () => undefined);
                const second = conn.on(`event-${round}`, () => undefined);

                first();

                expect(sources.at(0)?.listenerCount(`event-${round}`)).toBe(1);

                second();
                second();
            }

            const received: string[] = [];

            conn.on('event-0', msg => received.push(msg.data));
            sources.at(0)?.emitMessage('event-0', 'again');

            expect(sources.at(0)?.listenerCount('event-0')).toBe(1);
            expect(sources.at(0)?.listenerCount('event-1')).toBe(0);
            expect(received).toEqual(['again']);
        });

        it('attaches only live event names to a reconnected source', async () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({
                url: 'http://sse',
                backoff: fixedBackoff(100),
                eventSourceFactory: factory,
            });

            const unsubscribers = Array.from({ length: 20 }, (_, index) => conn.on(`gone-${index}`, () => undefined));

            conn.on('kept', () => undefined);
            conn.connect();

            for (const unsubscribe of unsubscribers) {
                unsubscribe();
            }

            sources.at(0)?.emitError();
            await vi.advanceTimersByTimeAsync(100);

            expect(sources.at(1)?.listenerCount('kept')).toBe(1);
            expect(sources.at(1)?.listenerCount('gone-0')).toBe(0);
            expect(sources.at(1)?.listenerCount('gone-19')).toBe(0);
        });

        it('leaves a resubscribed name alone when a stale unsubscribe runs', async () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({
                url: 'http://sse',
                backoff: fixedBackoff(100),
                eventSourceFactory: factory,
            });
            const received: string[] = [];

            conn.connect();

            const stale = conn.on('tick', () => undefined);

            stale();
            conn.on('tick', msg => received.push(msg.data));
            stale();
            sources.at(0)?.emitMessage('tick', 'live');
            sources.at(0)?.emitError();
            await vi.advanceTimersByTimeAsync(100);
            sources.at(1)?.emitMessage('tick', 'reconnected');

            expect(received).toEqual(['live', 'reconnected']);
        });

        it('unsubscribes while disconnected without touching a source', () => {
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: makeFactory().factory });
            const unsubscribe = conn.on('tick', () => undefined);

            expect(() => unsubscribe()).not.toThrow();
        });
    });

    describe('source ownership', () => {
        it('closes the failed source so only the adapter reconnects', async () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({
                url: 'http://sse',
                backoff: fixedBackoff(100),
                eventSourceFactory: factory,
            });

            conn.connect();
            sources.at(0)?.emitError();
            sources.at(0)?.emitError();

            expect(sources.at(0)?.closeCalls).toBe(1);
            expect(vi.getTimerCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(100);

            expect(sources).toHaveLength(2);
        });

        it('closes the new source when a state subscriber disconnects as it starts connecting', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });

            conn.onStateChange(state => {
                if (state === 'connecting') {
                    conn.disconnect();
                }
            });
            conn.connect();
            sources.at(0)?.emitOpen();

            expect(sources.at(0)?.closeCalls).toBe(1);
            expect(conn.state).toBe('closed');
        });

        it('cancels the reconnect when a state subscriber disconnects as it is scheduled', async () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({
                url: 'http://sse',
                backoff: fixedBackoff(100),
                eventSourceFactory: factory,
            });

            conn.connect();
            sources.at(0)?.emitOpen();
            conn.onStateChange(state => {
                if (state === 'connecting') {
                    conn.disconnect();
                }
            });
            sources.at(0)?.emitError();

            expect(vi.getTimerCount()).toBe(0);

            await vi.advanceTimersByTimeAsync(10_000);

            expect(sources).toHaveLength(1);
            expect(conn.state).toBe('closed');
        });
    });

    describe('reconnect policy', () => {
        it.each([
            ['retrying on its own', 0],
            ['closed', 2],
        ])('closes and reconnects through the backoff a source that errors while %s', async (_case, readyState) => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({
                url: 'http://sse',
                backoff: fixedBackoff(100),
                eventSourceFactory: factory,
            });

            conn.connect();
            sources.at(0)?.emitOpen();
            sources.at(0)?.fail(readyState);

            expect(sources.at(0)?.closeCalls).toBe(1);
            expect(conn.state).toBe('connecting');

            await vi.advanceTimersByTimeAsync(100);

            expect(sources).toHaveLength(2);
        });

        it('waits half the first backoff delay at the low end of the default equal jitter', async () => {
            vi.spyOn(Math, 'random').mockReturnValue(0);

            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });

            conn.connect();
            sources.at(0)?.emitError();
            await vi.advanceTimersByTimeAsync(499);

            expect(sources).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(1);

            expect(sources).toHaveLength(2);
        });

        it('detaches every listener from a released source', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });

            conn.on('tick', () => undefined);
            conn.connect();
            conn.disconnect();

            expect(sources.at(0)?.listenerCount('tick')).toBe(0);
        });
    });
});
