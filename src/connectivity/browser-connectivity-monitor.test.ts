/**
 * Unit tests for browser-connectivity-monitor.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeConnectivityMonitorContract } from '@sinemacula/foundation/connectivity/test-support/connectivity-monitor-contract';
import { BrowserConnectivityMonitor } from './browser-connectivity-monitor';

/**
 * Build a fake `Window` whose `navigator.onLine` follows the emitted events and
 * whose listeners can be triggered and inspected.
 */
function fakeWindow(onLine: boolean): {
    /** The fake window handed to the monitor. */
    window: Window;

    /** Flip `navigator.onLine` and dispatch the matching event to the registered listeners. */
    emit: (type: 'online' | 'offline') => void;

    /** Flip `navigator.onLine` without dispatching an event. */
    setOnLine: (value: boolean) => void;

    /** Count the listeners registered for an event. */
    listenerCount: (type: 'online' | 'offline') => number;
} {
    const listeners = new Map<string, Set<EventListener>>();
    const navigator = { onLine };

    const target = {
        navigator,
        addEventListener: (type: string, listener: EventListener) => {
            const set = listeners.get(type) ?? new Set<EventListener>();

            set.add(listener);
            listeners.set(type, set);
        },
        removeEventListener: (type: string, listener: EventListener) => {
            listeners.get(type)?.delete(listener);
        },
    } as unknown as Window;

    return {
        window: target,
        emit: type => {
            navigator.onLine = type === 'online';

            for (const listener of listeners.get(type) ?? []) {
                listener(new Event(type));
            }
        },
        setOnLine: value => {
            navigator.onLine = value;
        },
        listenerCount: type => listeners.get(type)?.size ?? 0,
    };
}

describeConnectivityMonitorContract({
    create: initial => {
        const target = fakeWindow(initial);

        return {
            monitor: new BrowserConnectivityMonitor({ targetWindow: target.window }),
            report: online => target.emit(online ? 'online' : 'offline'),
        };
    },
});

describe('BrowserConnectivityMonitor', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each([true, false])('reflects navigator.onLine (%s) at construction', onLine => {
        const fake = fakeWindow(onLine);
        const monitor = new BrowserConnectivityMonitor({ targetWindow: fake.window });

        expect(monitor.online).toBe(onLine);
    });

    it('notifies once per actual state change and dedupes repeated events', () => {
        const fake = fakeWindow(true);
        const monitor = new BrowserConnectivityMonitor({ targetWindow: fake.window });
        const handler = vi.fn();

        monitor.onChange(handler);
        monitor.start();

        fake.emit('offline');
        fake.emit('offline');

        expect(monitor.online).toBe(false);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(false);

        fake.emit('online');

        expect(monitor.online).toBe(true);
        expect(handler).toHaveBeenCalledTimes(2);
        expect(handler).toHaveBeenLastCalledWith(true);

        monitor.stop();
    });

    it('stops delivering to unsubscribed handlers', () => {
        const fake = fakeWindow(true);
        const monitor = new BrowserConnectivityMonitor({ targetWindow: fake.window });
        const handler = vi.fn();

        const unsubscribe = monitor.onChange(handler);

        unsubscribe();
        monitor.start();
        fake.emit('offline');

        expect(handler).not.toHaveBeenCalled();

        monitor.stop();
    });

    it('is idempotent across repeated start and stop calls', () => {
        const fake = fakeWindow(true);
        const monitor = new BrowserConnectivityMonitor({ targetWindow: fake.window });

        monitor.start();
        monitor.start();

        expect(fake.listenerCount('online')).toBe(1);
        expect(fake.listenerCount('offline')).toBe(1);

        monitor.stop();
        monitor.stop();

        expect(fake.listenerCount('online')).toBe(0);
        expect(fake.listenerCount('offline')).toBe(0);
    });

    it('detaches listeners after stop so no further notifications occur', () => {
        const fake = fakeWindow(true);
        const monitor = new BrowserConnectivityMonitor({ targetWindow: fake.window });
        const handler = vi.fn();

        monitor.onChange(handler);
        monitor.start();
        monitor.stop();

        fake.emit('offline');

        expect(handler).not.toHaveBeenCalled();
        expect(monitor.online).toBe(true);
    });

    it('catches up on a change missed while stopped', () => {
        const fake = fakeWindow(true);
        const monitor = new BrowserConnectivityMonitor({ targetWindow: fake.window });
        const handler = vi.fn();

        monitor.onChange(handler);
        monitor.start();
        monitor.stop();
        fake.setOnLine(false);
        monitor.start();

        expect(monitor.online).toBe(false);
        expect(handler.mock.calls).toStrictEqual([[false]]);

        fake.emit('online');

        expect(handler.mock.calls).toStrictEqual([[false], [true]]);

        monitor.stop();
    });

    it('catches up on a change between construction and the first start', () => {
        const fake = fakeWindow(true);
        const monitor = new BrowserConnectivityMonitor({ targetWindow: fake.window });
        const handler = vi.fn();

        monitor.onChange(handler);
        fake.setOnLine(false);
        monitor.start();

        expect(handler.mock.calls).toStrictEqual([[false]]);

        monitor.stop();
    });

    it('isolates a throwing subscriber and reports its error', () => {
        const failure = new Error('subscriber failure');
        const fake = fakeWindow(true);
        const onError = vi.fn();
        const monitor = new BrowserConnectivityMonitor({ targetWindow: fake.window, onError });
        const handler = vi.fn();

        monitor.onChange(() => {
            throw failure;
        });
        monitor.onChange(handler);
        monitor.start();
        fake.emit('offline');

        expect(handler).toHaveBeenCalledWith(false);
        expect(onError).toHaveBeenCalledWith(failure);

        monitor.stop();
    });

    it('reports subscriber errors globally by default and survives a throwing sink', () => {
        const failure = new Error('subscriber failure');
        const reportError = vi.fn(() => {
            throw new Error('sink failure');
        });
        const fake = fakeWindow(true);
        const handler = vi.fn();

        vi.stubGlobal('reportError', reportError);

        const monitor = new BrowserConnectivityMonitor({ targetWindow: fake.window });

        monitor.onChange(() => {
            throw failure;
        });
        monitor.onChange(handler);
        monitor.start();
        fake.emit('offline');

        expect(reportError).toHaveBeenCalledWith(failure);
        expect(handler).toHaveBeenCalledWith(false);

        monitor.stop();
    });

    it('uses the global window when no target window is provided', () => {
        const fake = fakeWindow(false);

        vi.stubGlobal('window', fake.window);

        const monitor = new BrowserConnectivityMonitor();

        expect(monitor.online).toBe(false);
    });
});
