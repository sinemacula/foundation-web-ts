/**
 * Unit tests for web-connectivity-monitor.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReachabilityProbe } from '@sinemacula/foundation/connectivity/confirmed-connectivity-monitor';
import { describeConnectivityMonitorContract } from '@sinemacula/foundation/connectivity/test-support/connectivity-monitor-contract';
import type { WebConnectivityMonitorOptions } from './web-connectivity-monitor';
import { WebConnectivityMonitor } from './web-connectivity-monitor';

/** A page whose connectivity, visibility and lifecycle the test drives. */
interface Page {
    /** The window handed to the monitor. */
    readonly targetWindow: Window;

    /** The document handed to the monitor. */
    readonly targetDocument: Document;

    /** Set the browser's connectivity and fire its event. */
    readonly report: (online: boolean) => void;

    /** Set the document's visibility and fire its event. */
    readonly show: (visible: boolean) => void;
}

/**
 * Build a visible page at a connectivity.
 */
function makePage(onLine: boolean): Page {
    const navigator = { onLine };
    const targetWindow = Object.assign(new EventTarget(), { navigator }) as unknown as Window;
    const targetDocument = document.implementation.createHTMLDocument('t');
    let visibility: DocumentVisibilityState = 'visible';

    Object.defineProperty(targetDocument, 'visibilityState', { get: () => visibility });

    return {
        targetWindow,
        targetDocument,
        report: online => {
            navigator.onLine = online;
            targetWindow.dispatchEvent(new Event(online ? 'online' : 'offline'));
        },
        show: visible => {
            visibility = visible ? 'visible' : 'hidden';
            targetDocument.dispatchEvent(new Event('visibilitychange'));
        },
    };
}

/**
 * A probe that always finds the site reachable.
 */
function isReachable(): Promise<boolean> {
    return Promise.resolve(true);
}

/**
 * Build a `pageshow` event, persisted when restored from the back-forward
 * cache.
 */
function pageShow(persisted: boolean): Event {
    return Object.defineProperty(new Event('pageshow'), 'persisted', { value: persisted });
}

/**
 * Build a monitor over a page and a probe answering `reachable`.
 */
function build(onLine: boolean, options: Partial<WebConnectivityMonitorOptions> = {}) {
    const page = makePage(onLine);
    const state = { reachable: onLine };
    const probe = vi.fn<ReachabilityProbe>(() => Promise.resolve(state.reachable));
    const monitor = new WebConnectivityMonitor({
        probe,
        targetWindow: page.targetWindow,
        targetDocument: page.targetDocument,
        ...options,
    });

    return { monitor, page, state, probe };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describeConnectivityMonitorContract({
    create: initial => {
        const { monitor, page, state } = build(initial);

        return {
            monitor,
            report: online => {
                state.reachable = online;
                page.report(online);
            },
        };
    },
    settle: async () => {
        await vi.advanceTimersByTimeAsync(60_000);
    },
});

describe('WebConnectivityMonitor', () => {
    it('stops probing while hidden and gathers fresh evidence once visible', async () => {
        const { monitor, page, state, probe } = build(true);
        const handler = vi.fn();
        monitor.onChange(handler);
        monitor.start();
        await vi.advanceTimersByTimeAsync(0);

        state.reachable = false;
        monitor.hint(false);
        await vi.advanceTimersByTimeAsync(3_000);
        page.show(false);
        const probes = probe.mock.calls.length;
        await vi.advanceTimersByTimeAsync(60_000);

        expect(probe).toHaveBeenCalledTimes(probes);
        expect(monitor.online).toBe(true);

        page.show(true);
        await vi.advanceTimersByTimeAsync(4_500);

        expect(handler).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_500);

        expect(handler.mock.calls).toStrictEqual([[false]]);
    });

    it('does not probe when started on a hidden page', async () => {
        const { monitor, page, probe } = build(true);
        page.show(false);
        monitor.start();
        await vi.advanceTimersByTimeAsync(60_000);

        expect(probe).not.toHaveBeenCalled();
    });

    it('restarts probing for a page restored from the back-forward cache only', async () => {
        const { monitor, page, probe } = build(true);
        monitor.start();
        await vi.advanceTimersByTimeAsync(0);

        page.targetWindow.dispatchEvent(pageShow(false));

        expect(probe).toHaveBeenCalledTimes(1);

        page.targetWindow.dispatchEvent(pageShow(true));

        expect(probe).toHaveBeenCalledTimes(2);
    });

    it('stops following the page once stopped', async () => {
        const { monitor, page, probe } = build(true);
        monitor.start();
        monitor.stop();
        monitor.stop();
        page.show(true);
        page.targetWindow.dispatchEvent(pageShow(true));
        await vi.advanceTimersByTimeAsync(60_000);

        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('passes the timings through', async () => {
        const { monitor, state } = build(true, { offlineAfter: 0 });
        monitor.start();
        await vi.advanceTimersByTimeAsync(0);
        state.reachable = false;
        monitor.hint(false);
        await vi.advanceTimersByTimeAsync(1_500);

        expect(monitor.online).toBe(false);
    });

    it('reports a throwing subscriber to the global error sink by default', async () => {
        const reportError = vi.fn();
        const error = new Error('handler');

        vi.stubGlobal('reportError', reportError);

        const { monitor, state } = build(true);
        monitor.onChange(() => {
            throw error;
        });
        state.reachable = false;
        monitor.start();
        await vi.advanceTimersByTimeAsync(6_000);

        expect(reportError).toHaveBeenCalledWith(error);
    });

    it('observes the global window and document by default', () => {
        const monitor = new WebConnectivityMonitor({ probe: isReachable });
        const add = vi.spyOn(document, 'addEventListener');

        monitor.start();

        expect(add).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

        monitor.stop();
    });
});
