/**
 * Unit tests for use-connectivity.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it, vi } from 'vitest';
import { createApp, effectScope, isReadonly } from 'vue';

import type {
    ConnectivityHandler,
    ConnectivityMonitor,
} from '@sinemacula/foundation/connectivity/connectivity-monitor';
import { CONNECTIVITY_MONITOR, ConnectivityUnavailableError, useConnectivity } from './use-connectivity';

/**
 * Build a monitor whose published state the test sets.
 */
function makeMonitor(online: boolean) {
    const handlers = new Set<ConnectivityHandler>();
    const monitor: ConnectivityMonitor = {
        online,
        start: () => undefined,
        stop: () => undefined,
        onChange: handler => {
            handlers.add(handler);

            return () => {
                handlers.delete(handler);
            };
        },
    };

    return {
        monitor,
        handlers,
        publish: (next: boolean) => {
            for (const handler of handlers) {
                handler(next);
            }
        },
    };
}

/**
 * Run a function inside an application that provides the monitor.
 */
function withMonitor<R>(monitor: ConnectivityMonitor, run: () => R): R {
    const app = createApp({});

    app.provide(CONNECTIVITY_MONITOR, monitor);

    return app.runWithContext(run);
}

describe('useConnectivity', () => {
    it('follows the published state through a read-only ref', () => {
        const { monitor, publish } = makeMonitor(true);
        const online = withMonitor(monitor, useConnectivity);

        expect(online.value).toBe(true);
        expect(isReadonly(online)).toBe(true);

        publish(false);

        expect(online.value).toBe(false);
    });

    it('unsubscribes with the calling scope', () => {
        const { monitor, handlers } = makeMonitor(true);
        const scope = effectScope();

        withMonitor(monitor, () => scope.run(useConnectivity));

        expect(handlers.size).toBe(1);

        scope.stop();

        expect(handlers.size).toBe(0);
    });

    it('stays subscribed outside a scope, without registering a disposer', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { monitor, handlers } = makeMonitor(false);

        expect(withMonitor(monitor, useConnectivity).value).toBe(false);
        expect(handlers.size).toBe(1);
        expect(warn).not.toHaveBeenCalled();
    });

    it('throws without a provided monitor', () => {
        expect(() => createApp({}).runWithContext(useConnectivity)).toThrow(ConnectivityUnavailableError);
        expect(() => createApp({}).runWithContext(useConnectivity)).toThrow(
            expect.objectContaining({ name: 'ConnectivityUnavailableError' }),
        );
        expect(() => createApp({}).runWithContext(useConnectivity)).toThrow(
            'useConnectivity() needs connectivity monitoring, which is disabled or outside this application.',
        );
    });
});
