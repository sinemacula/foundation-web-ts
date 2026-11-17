/**
 * Browser connectivity monitor that ignores repeated online/offline events.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type {
    ConnectivityHandler,
    ConnectivityMonitor,
} from '@sinemacula/foundation/connectivity/connectivity-monitor';

export interface ConnectivityMonitorOptions {
    /** The window whose connectivity events are observed; defaults to the global window. */
    readonly targetWindow?: Window;
}

/**
 * Tracks browser network connectivity and notifies subscribers on change.
 */
export class BrowserConnectivityMonitor implements ConnectivityMonitor {
    /** The window whose connectivity events are observed. */
    readonly #targetWindow: Window;

    /** The registered connectivity subscribers. */
    readonly #handlers = new Set<ConnectivityHandler>();

    /**
     * Records the online state when an online event fires.
     */
    readonly #onOnline = (): void => {
        this.#setOnline(true);
    };

    /**
     * Records the offline state when an offline event fires.
     */
    readonly #onOffline = (): void => {
        this.#setOnline(false);
    };

    /** The last observed connectivity state. */
    #online: boolean;

    /** Whether the monitor is currently observing events. */
    #started: boolean = false;

    constructor(options: ConnectivityMonitorOptions = {}) {
        this.#targetWindow = options.targetWindow ?? globalThis.window;
        this.#online = this.#targetWindow.navigator.onLine;
    }

    /**
     * The current connectivity state.
     */
    get online(): boolean {
        return this.#online;
    }

    /**
     * Begin observing connectivity events; no-op when running.
     */
    start(): void {
        if (this.#started) {
            return;
        }

        this.#started = true;

        this.#targetWindow.addEventListener('online', this.#onOnline);
        this.#targetWindow.addEventListener('offline', this.#onOffline);
    }

    /**
     * Stop observing and detach the connectivity listeners.
     */
    stop(): void {
        if (!this.#started) {
            return;
        }

        this.#started = false;

        this.#targetWindow.removeEventListener('online', this.#onOnline);
        this.#targetWindow.removeEventListener('offline', this.#onOffline);
    }

    /**
     * Subscribe to connectivity changes, notified once per actual change.
     *
     * @returns an unsubscribe function
     */
    onChange(handler: ConnectivityHandler): () => void {
        this.#handlers.add(handler);

        return () => {
            this.#handlers.delete(handler);
        };
    }

    /**
     * Record a new state, notifying subscribers only when it changed.
     */
    #setOnline(online: boolean): void {
        if (online === this.#online) {
            return;
        }

        this.#online = online;

        for (const handler of this.#handlers) {
            handler(online);
        }
    }
}
