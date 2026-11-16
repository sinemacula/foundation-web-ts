/**
 * Unit tests for event-source-connection.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { ExponentialBackoff } from '@sinemacula/foundation/realtime/exponential-backoff';
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

    /** The listeners registered per event name. */
    readonly #listeners: Map<string, Array<(event: MessageEvent) => void>> = new Map();

    /**
     * Record the construction arguments.
     *
     * @param url - the SSE endpoint URL
     * @param init - the EventSource initialisation options
     */
    constructor(url: string, init: EventSourceInit) {
        this.url = url;
        this.withCredentials = init.withCredentials ?? false;
    }

    /**
     * Register a listener for a named event.
     *
     * @param type - the event name
     * @param listener - the listener to call for each event
     */
    addEventListener(type: string, listener: (event: MessageEvent) => void): void {
        const listeners = this.#listeners.get(type) ?? [];

        listeners.push(listener);
        this.#listeners.set(type, listeners);
    }

    /**
     * Record a close call.
     */
    close(): void {
        this.closeCalls++;
    }

    /**
     * Simulate the source opening.
     */
    emitOpen(): void {
        this.onopen?.(new Event('open'));
    }

    /**
     * Simulate the source failing.
     */
    emitError(): void {
        this.onerror?.(new Event('error'));
    }

    /**
     * Simulate an incoming named event.
     *
     * @param type - the event name
     * @param data - the event payload
     */
    emitMessage(type: string, data: unknown): void {
        const event = new MessageEvent(type, { data });

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

    /** While true, the factory throws instead of creating a source. */
    failing: boolean;
}

/**
 * Create a typed {@link EventSourceFactory} that records each fake it creates.
 * The cast to `EventSource` is confined to the closure so every test body can
 * use the strongly-typed {@link FakeEventSource} directly.
 *
 * @returns the recorded sources, the factory and its failure switch
 */
function makeFactory(): RecordingFactory {
    const recording: RecordingFactory = {
        sources: [],
        factory: (url, init) => {
            if (recording.failing) {
                throw new Error('factory failed');
            }

            const source = new FakeEventSource(url, init);

            recording.sources.push(source);

            return source as unknown as EventSource;
        },
        failing: false,
    };

    return recording;
}

/**
 * Fixed-delay backoff for deterministic reconnect assertions.
 *
 * @param delay - the delay in milliseconds for every attempt
 * @returns the backoff strategy
 */
function fixedBackoff(delay: number): ExponentialBackoff {
    return new ExponentialBackoff({ initialDelay: delay, multiplier: 1, maxDelay: delay });
}

/**
 * Adapt the SSE adapter and its fake to the shared realtime contract.
 *
 * @returns the contract harness
 */
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
                 *
                 * @param args - the arguments the constructor received
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

        it('keeps delivering to remaining subscribers when one throws', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });

            const received: string[] = [];

            conn.on('update', () => {
                throw new Error('subscriber exploded');
            });
            conn.on('update', msg => received.push(msg.data));
            conn.connect();
            sources.at(0)?.emitMessage('update', 'payload');

            expect(received).toEqual(['payload']);
        });

        it('keeps notifying remaining state subscribers when one throws', () => {
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });

            const states: string[] = [];

            conn.onStateChange(() => {
                throw new Error('subscriber exploded');
            });
            conn.onStateChange(state => states.push(state));
            conn.connect();
            sources.at(0)?.emitOpen();

            expect(states).toEqual(['connecting', 'open']);
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

        it('ignores events from a source it has released', () => {
            const received: string[] = [];
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: factory });

            conn.on('update', msg => received.push(msg.data));
            conn.connect();
            conn.disconnect();
            conn.connect();

            sources.at(0)?.emitOpen();
            sources.at(0)?.emitMessage('update', 'stale');
            sources.at(0)?.emitError();

            expect(conn.state).toBe('connecting');
            expect(received).toEqual([]);
            expect(vi.getTimerCount()).toBe(0);
            expect(sources.at(0)?.closeCalls).toBe(1);

            sources.at(1)?.emitOpen();
            sources.at(1)?.emitMessage('update', 'fresh');

            expect(conn.state).toBe('open');
            expect(received).toEqual(['fresh']);
        });
    });

    describe('open failures', () => {
        it('wraps a throwing EventSource factory in a RealtimeError on connect()', () => {
            const recording = makeFactory();
            const conn = new EventSourceConnection({ url: 'http://sse', eventSourceFactory: recording.factory });

            recording.failing = true;

            expect(() => conn.connect()).toThrow(
                expect.objectContaining({
                    name: 'RealtimeError',
                    message: 'Cannot connect: the EventSource could not be opened.',
                    cause: new Error('factory failed'),
                }),
            );
            expect(conn.state).toBe('idle');
        });

        it('leaves the state closed when the url builder throws on a connect() after disconnect()', () => {
            const cause = new Error('no token');
            let fail = false;
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({
                url: () => {
                    if (fail) {
                        throw cause;
                    }

                    return 'http://sse';
                },
                eventSourceFactory: factory,
            });

            conn.connect();
            conn.disconnect();
            fail = true;

            expect(() => conn.connect()).toThrow(expect.objectContaining({ name: 'RealtimeError', cause }));
            expect(conn.state).toBe('closed');
            expect(sources).toHaveLength(1);
        });

        it('reschedules with backoff and reports the error when the factory throws on a reconnect', async () => {
            const errors: unknown[] = [];
            const recording = makeFactory();
            const { sources } = recording;
            const conn = new EventSourceConnection({
                url: 'http://sse',
                backoff: new ExponentialBackoff({ initialDelay: 100, multiplier: 2, maxDelay: 10_000 }),
                eventSourceFactory: recording.factory,
                onError: error => errors.push(error),
            });

            conn.connect();
            sources.at(0)?.emitError();
            recording.failing = true;

            await vi.advanceTimersByTimeAsync(100);

            expect(errors).toEqual([new Error('factory failed')]);
            expect(conn.state).toBe('connecting');
            expect(vi.getTimerCount()).toBe(1);

            recording.failing = false;

            // Attempt 1 waits 200 ms: the failed attempt advanced the backoff.
            await vi.advanceTimersByTimeAsync(199);
            expect(sources).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(1);
            expect(sources).toHaveLength(2);

            sources.at(1)?.emitOpen();
            expect(conn.state).toBe('open');
        });

        it('reschedules without an onError sink when the url builder throws on a reconnect', async () => {
            let calls = 0;
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({
                url: () => {
                    if (++calls === 2) {
                        throw new Error('no token');
                    }

                    return 'http://sse';
                },
                backoff: fixedBackoff(100),
                eventSourceFactory: factory,
            });

            conn.connect();
            sources.at(0)?.emitError();

            await vi.advanceTimersByTimeAsync(100);

            expect(sources).toHaveLength(1);
            expect(conn.state).toBe('connecting');

            await vi.advanceTimersByTimeAsync(100);

            expect(sources).toHaveLength(2);
        });
    });

    describe('onError', () => {
        it('receives errors thrown by message and state subscribers', () => {
            const errors: unknown[] = [];
            const messageError = new Error('message subscriber');
            const stateError = new Error('state subscriber');
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({
                url: 'http://sse',
                eventSourceFactory: factory,
                onError: error => errors.push(error),
            });

            conn.on('update', () => {
                throw messageError;
            });
            conn.onStateChange(() => {
                throw stateError;
            });
            conn.connect();
            sources.at(0)?.emitMessage('update', 'hello');

            expect(errors).toEqual([stateError, messageError]);
        });

        it('keeps delivering to remaining subscribers when the sink itself throws', () => {
            const received: string[] = [];
            const states: string[] = [];
            const { sources, factory } = makeFactory();
            const conn = new EventSourceConnection({
                url: 'http://sse',
                eventSourceFactory: factory,
                onError: () => {
                    throw new Error('sink exploded');
                },
            });

            conn.on('update', () => {
                throw new Error('subscriber exploded');
            });
            conn.on('update', msg => received.push(msg.data));
            conn.onStateChange(() => {
                throw new Error('subscriber exploded');
            });
            conn.onStateChange(state => states.push(state));
            conn.connect();
            sources.at(0)?.emitOpen();
            sources.at(0)?.emitMessage('update', 'hello');

            expect(received).toEqual(['hello']);
            expect(states).toEqual(['connecting', 'open']);
        });
    });
});
