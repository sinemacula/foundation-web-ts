/**
 * Unit tests for browser-connectivity-monitor.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserConnectivityMonitor } from './browser-connectivity-monitor';

/**
 * Build a fake `Window` with a fixed `navigator.onLine` whose listeners can be
 * triggered and inspected.
 */
function fakeWindow(onLine: boolean): {
    /** The fake window handed to the monitor. */
    window: Window;

    /** Dispatch an event to the registered listeners. */
    emit: (type: 'online' | 'offline') => void;

    /** Count the listeners registered for an event. */
    listenerCount: (type: 'online' | 'offline') => number;
} {
    const listeners = new Map<string, Set<EventListener>>();

    const target = {
        navigator: { onLine },
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
            for (const listener of listeners.get(type) ?? []) {
                listener(new Event(type));
            }
        },
        listenerCount: type => listeners.get(type)?.size ?? 0,
    };
}

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

    it('uses the global window when no target window is provided', () => {
        const fake = fakeWindow(false);

        vi.stubGlobal('window', fake.window);

        const monitor = new BrowserConnectivityMonitor();

        expect(monitor.online).toBe(false);
    });
});
