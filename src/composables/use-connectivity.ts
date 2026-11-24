/**
 * Reactive confirmed connectivity for components, such as an offline banner.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ConnectivityMonitor } from '@sinemacula/foundation/connectivity/connectivity-monitor';
import type { InjectionKey, Ref } from 'vue';
import { followProvidedFlag } from './follow-flag';

/**
 * Thrown by {@link useConnectivity} when no connectivity monitor is provided.
 */
export class ConnectivityUnavailableError extends Error {
    /**
     * Construct the error explaining why no monitor is available.
     */
    constructor() {
        super('useConnectivity() needs connectivity monitoring, which is disabled or outside this application.');
        this.name = 'ConnectivityUnavailableError';
    }
}

/** Provides the application's connectivity monitor to its components. */
export const CONNECTIVITY_MONITOR: InjectionKey<ConnectivityMonitor> = Symbol('connectivity-monitor');

/**
 * Follow the application's confirmed connectivity: true while the site is
 * reachable, false once a loss is confirmed. Unsubscribes with the calling
 * scope.
 *
 * @throws {ConnectivityUnavailableError} when connectivity monitoring is
 * disabled or the caller is outside the application
 */
export function useConnectivity(): Readonly<Ref<boolean>> {
    return followProvidedFlag(
        CONNECTIVITY_MONITOR,
        () => new ConnectivityUnavailableError(),
        monitor => monitor.online,
    );
}
