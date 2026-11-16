/**
 * Unit tests for web-socket-connection.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { describeRealtimeContract, type RealtimeContractHarness } from './test-support/realtime-connection-contract';
import { WebSocketConnection, type WebSocketFactory } from './web-socket-connection';

/** Minimal fake WebSocket for injection via the factory. */
class FakeWebSocket {
    /** The URL the adapter opened this socket with. */
    readonly url: string;

    /** The subprotocols the adapter passed, if any. */
    readonly protocols: string | readonly string[] | undefined;

    /** The open handler the adapter assigns; fired by emitOpen(). */
    onopen: ((event: Event) => void) | null = null;

    /** The message handler the adapter assigns; fired by emitMessage(). */
    onmessage: ((event: MessageEvent) => void) | null = null;

    /** The close handler the adapter assigns; fired by emitClose(). */
    onclose: ((event: CloseEvent) => void) | null = null;

    /** Whether close() has been called on this socket. */
    #closed: boolean = false;

    /** The number of times the adapter called close(). */
    closeCalls: number = 0;

    /** Every payload the adapter sent, in order. */
    sentMessages: string[] = [];

    constructor(url: string, protocols?: string | readonly string[]) {
        this.url = url;
        this.protocols = protocols;
    }

    /**
     * Record an outgoing payload.
     */
    send(data: string): void {
        this.sentMessages.push(data);
    }

    /**
     * Mark the socket closed and count the call.
     */
    close(): void {
        this.#closed = true;
        this.closeCalls++;
    }

    /**
     * Whether the adapter has closed this socket.
     */
    get closed(): boolean {
        return this.#closed;
    }

    /**
     * Simulate the server accepting the connection.
     */
    emitOpen(): void {
        this.onopen?.(new Event('open'));
    }

    /**
     * Simulate an incoming frame carrying the given data.
     */
    emitMessage(data: string): void {
        this.onmessage?.(new MessageEvent('message', { data }));
    }

    /**
     * Simulate the connection dropping, which drives the adapter's reconnect
     * path.
     */
    emitClose(): void {
        this.onclose?.(new CloseEvent('close'));
    }
}

/** A factory to inject into the adapter and the fakes it has created so far. */
interface RecordingFactory {
    /** Every fake the factory has created, in creation order. */
    sockets: FakeWebSocket[];

    /** The factory passed to the adapter as `webSocketFactory`. */
    factory: WebSocketFactory;
}

/**
 * Creates a typed {@link WebSocketFactory} that records each fake it creates.
 * The cast to `WebSocket` is confined to a single line inside the closure so
 * every test body can use the strongly-typed {@link FakeWebSocket} directly.
 */
function makeFactory(): RecordingFactory {
    const sockets: FakeWebSocket[] = [];

    /** Build a fake socket and record it before handing it to the adapter. */
    const factory: WebSocketFactory = (url, protocols) => {
        const socket = new FakeWebSocket(url, protocols);

        sockets.push(socket);

        return socket as unknown as WebSocket;
    };

    return { sockets, factory };
}

/** Adapts the WebSocket adapter and its fake to the shared realtime contract. */
function makeWsContractHarness(): RealtimeContractHarness {
    return {
        create(options) {
            const { sockets, factory } = makeFactory();
            const connection = new WebSocketConnection({ ...options, webSocketFactory: factory });

            return {
                connection,
                transports: {
                    get length() {
                        return sockets.length;
                    },
                    at(index) {
                        const socket = sockets.at(index);

                        if (socket === undefined) {
                            return undefined;
                        }

                        return {
                            get url() {
                                return socket.url;
                            },
                            get closeCalls() {
                                return socket.closeCalls;
                            },
                            open: () => socket.emitOpen(),
                            fail: () => socket.emitClose(),
                            message: (event, data) => socket.emitMessage(JSON.stringify({ event, data })),
                        };
                    },
                },
            };
        },
    };
}

describeRealtimeContract(makeWsContractHarness());

describe('WebSocketConnection', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('connect()', () => {
        it('passes protocols to the factory', () => {
            const { sockets, factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', protocols: 'v1', webSocketFactory: factory });

            conn.connect();

            const socket = sockets.at(0);

            expect(socket).toBeDefined();
            expect(socket?.protocols).toBe('v1');
        });

        it('exercises the default WebSocket factory with no protocols', () => {
            // happy-dom provides a WebSocket stub so connect() does not throw;
            // this covers the protocols === undefined branch in the default
            // factory.
            const conn = new WebSocketConnection({ url: 'ws://localhost' });

            expect(() => conn.connect()).not.toThrow();
        });

        it('exercises the default WebSocket factory with a string protocol', () => {
            // Covers the typeof protocols === 'string' branch in the default
            // factory.
            const conn = new WebSocketConnection({ url: 'ws://localhost', protocols: 'v1' });

            expect(() => conn.connect()).not.toThrow();
        });

        it('exercises the default WebSocket factory with an array of protocols', () => {
            // Covers the readonly string[] -> string[] cast branch in the
            // default factory.
            const conn = new WebSocketConnection({ url: 'ws://localhost', protocols: ['v1', 'v2'] });

            expect(() => conn.connect()).not.toThrow();
        });
    });

    describe('on()', () => {
        it('delivers the raw frame to message subscribers', () => {
            const { sockets, factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', webSocketFactory: factory });

            const received: string[] = [];

            conn.on('message', msg => received.push(msg.data));
            conn.connect();
            sockets.at(0)?.emitOpen();
            sockets.at(0)?.emitMessage('hello');

            expect(received).toEqual(['hello']);
        });

        it('sets event to "message" for raw frame delivery', () => {
            const { sockets, factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', webSocketFactory: factory });

            const events: string[] = [];

            conn.on('message', msg => events.push(msg.event));
            conn.connect();
            sockets.at(0)?.emitOpen();
            sockets.at(0)?.emitMessage('data');

            expect(events).toEqual(['message']);
        });

        it('delivers an envelope frame to both message and named-event subscribers', () => {
            const { sockets, factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', webSocketFactory: factory });

            const messages: string[] = [];
            const updates: string[] = [];

            conn.on('message', msg => messages.push(msg.data));
            conn.on('update', msg => updates.push(msg.data));
            conn.connect();
            sockets.at(0)?.emitOpen();
            sockets.at(0)?.emitMessage(JSON.stringify({ event: 'update', data: 'payload' }));

            expect(messages).toEqual([JSON.stringify({ event: 'update', data: 'payload' })]);
            expect(updates).toEqual(['payload']);
        });

        it('stringifies non-string envelope data', () => {
            const { sockets, factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', webSocketFactory: factory });

            const received: string[] = [];

            conn.on('tick', msg => received.push(msg.data));
            conn.connect();
            sockets.at(0)?.emitOpen();
            sockets.at(0)?.emitMessage(JSON.stringify({ event: 'tick', data: { value: 42 } }));

            expect(received).toEqual([JSON.stringify({ value: 42 })]);
        });

        it('handles a JSON envelope whose data is null', () => {
            const { sockets, factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', webSocketFactory: factory });

            const received: string[] = [];

            conn.on('evt', msg => received.push(msg.data));
            conn.connect();
            sockets.at(0)?.emitOpen();
            sockets.at(0)?.emitMessage(JSON.stringify({ event: 'evt', data: null }));

            expect(received).toEqual(['null']);
        });

        it('does not dispatch to named-event subscribers for non-JSON frames', () => {
            const { sockets, factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', webSocketFactory: factory });

            const namedReceived: string[] = [];
            const messageReceived: string[] = [];

            conn.on('update', msg => namedReceived.push(msg.data));
            conn.on('message', msg => messageReceived.push(msg.data));
            conn.connect();
            sockets.at(0)?.emitOpen();
            sockets.at(0)?.emitMessage('not json');

            expect(namedReceived).toEqual([]);
            expect(messageReceived).toEqual(['not json']);
        });

        it('does not dispatch to named-event subscribers for invalid envelope shapes', () => {
            const { sockets, factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', webSocketFactory: factory });

            const namedReceived: string[] = [];

            conn.on('update', msg => namedReceived.push(msg.data));
            conn.connect();
            sockets.at(0)?.emitOpen();

            // Missing 'event' field.
            sockets.at(0)?.emitMessage(JSON.stringify({ data: 'something' }));
            // Non-string 'event' field.
            sockets.at(0)?.emitMessage(JSON.stringify({ event: 42, data: 'something' }));
            // Missing 'data' field.
            sockets.at(0)?.emitMessage(JSON.stringify({ event: 'update' }));

            expect(namedReceived).toEqual([]);
        });

        it('delivers envelope "message" event frames only to message subscribers once', () => {
            // An envelope with event='message' should not be double-delivered.
            const { sockets, factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', webSocketFactory: factory });

            const received: string[] = [];

            conn.on('message', msg => received.push(msg.data));
            conn.connect();
            sockets.at(0)?.emitOpen();
            sockets.at(0)?.emitMessage(JSON.stringify({ event: 'message', data: 'hi' }));

            // Delivered once via the raw-frame path; not a second time from the
            // envelope path.
            expect(received).toHaveLength(1);
        });

        it('does not deliver messages when no handlers are registered for the event', () => {
            const { sockets, factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', webSocketFactory: factory });

            conn.connect();
            sockets.at(0)?.emitOpen();

            // No handler registered - must not throw.
            expect(() => sockets.at(0)?.emitMessage('hello')).not.toThrow();
        });

        it('does not treat a JSON primitive frame as an envelope', () => {
            const { sockets, factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', webSocketFactory: factory });

            const namedReceived: string[] = [];
            const messageReceived: string[] = [];

            conn.on('update', msg => namedReceived.push(msg.data));
            conn.on('message', msg => messageReceived.push(msg.data));
            conn.connect();
            sockets.at(0)?.emitOpen();

            // A frame that is valid JSON but not an object is not an envelope;
            // it is delivered only as the raw message frame.
            sockets.at(0)?.emitMessage('42');

            expect(namedReceived).toEqual([]);
            expect(messageReceived).toEqual(['42']);
        });
    });

    describe('send()', () => {
        it('sends data over the open socket', () => {
            const { sockets, factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', webSocketFactory: factory });

            conn.connect();
            sockets.at(0)?.emitOpen();
            conn.send('hello');

            const socket = sockets.at(0);

            expect(socket).toBeDefined();
            expect(socket?.sentMessages).toEqual(['hello']);
        });

        it('throws when the socket is not open (idle)', () => {
            const { factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', webSocketFactory: factory });

            expect(() => conn.send('msg')).toThrow('Cannot send: WebSocket is not open.');
        });

        it('throws when the socket is connecting', () => {
            const { factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', webSocketFactory: factory });

            conn.connect();

            expect(() => conn.send('msg')).toThrow('Cannot send: WebSocket is not open.');
        });

        it('throws when the socket is closed', () => {
            const { sockets, factory } = makeFactory();
            const conn = new WebSocketConnection({ url: 'ws://test', webSocketFactory: factory });

            conn.connect();
            sockets.at(0)?.emitOpen();
            conn.disconnect();

            expect(() => conn.send('msg')).toThrow('Cannot send: WebSocket is not open.');
        });
    });
});
