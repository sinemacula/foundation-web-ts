/**
 * Confirmed browser connectivity that probes only while the page is visible.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type {
    ConfirmedConnectivityMonitorOptions,
    ConnectivityHintSink,
    ReachabilityProbe,
} from '@sinemacula/foundation/connectivity/confirmed-connectivity-monitor';
import { ConfirmedConnectivityMonitor } from '@sinemacula/foundation/connectivity/confirmed-connectivity-monitor';
import type {
    ConnectivityHandler,
    ConnectivityMonitor,
} from '@sinemacula/foundation/connectivity/connectivity-monitor';
import { BrowserConnectivityMonitor } from './browser-connectivity-monitor';

/** The confirmation timings a web application may tune. */
export type ConnectivityTimings = Pick<
    ConfirmedConnectivityMonitorOptions,
    'offlineAfter' | 'onlineAfter' | 'probeInterval' | 'probeTimeout' | 'heartbeatInterval' | 'recoveryBackoff'
>;

/** Options for {@link WebConnectivityMonitor}. */
export interface WebConnectivityMonitorOptions extends ConnectivityTimings {
    /** The reachability check whose results decide the state. */
    readonly probe: ReachabilityProbe;

    /** The window whose online and offline events are hints; defaults to the global window. */
    readonly targetWindow?: Window;

    /** The document whose visibility gates probing; defaults to the global document. */
    readonly targetDocument?: Document;

    /** Receives an error thrown by a subscriber, which never stops the others; defaults to the global `reportError`. */
    readonly onError?: (error: unknown) => void;
}

/**
 * Publishes connectivity once probes confirm it, probing only while the page is
 * visible. A hidden page keeps the last published state; becoming visible
 * again, or returning from the back-forward cache, gathers fresh evidence.
 */
export class WebConnectivityMonitor implements ConnectivityMonitor, ConnectivityHintSink {
    /** The confirmed monitor doing the probing. */
    readonly #confirmed: ConfirmedConnectivityMonitor;

    /** The window whose page lifecycle is observed. */
    readonly #targetWindow: Window;

    /** The document whose visibility is observed. */
    readonly #targetDocument: Document;

    /**
     * Follows the page's visibility.
     */
    readonly #onVisibilityChange = (): void => {
        this.#follow();
    };

    /**
     * Restarts probing for a page restored from the back-forward cache.
     */
    readonly #onPageShow = (event: PageTransitionEvent): void => {
        if (event.persisted) {
            this.#confirmed.stop();
            this.#follow();
        }
    };

    constructor(options: WebConnectivityMonitorOptions) {
        const { probe, targetWindow, targetDocument, onError, ...timings } = options;
        const report = onError ?? (error => globalThis.reportError(error));

        this.#targetWindow = targetWindow ?? globalThis.window;
        this.#targetDocument = targetDocument ?? globalThis.document;
        this.#confirmed = new ConfirmedConnectivityMonitor({
            ...timings,
            platform: new BrowserConnectivityMonitor({ targetWindow: this.#targetWindow, onError: report }),
            probe,
            onError: report,
        });
    }

    /**
     * The published connectivity.
     */
    get online(): boolean {
        return this.#confirmed.online;
    }

    /**
     * Observe the page and probe while it is visible; a no-op when started.
     */
    start(): void {
        this.#targetDocument.addEventListener('visibilitychange', this.#onVisibilityChange);
        this.#targetWindow.addEventListener('pageshow', this.#onPageShow);
        this.#follow();
    }

    /**
     * Stop observing and probing; a no-op when stopped.
     */
    stop(): void {
        this.#targetDocument.removeEventListener('visibilitychange', this.#onVisibilityChange);
        this.#targetWindow.removeEventListener('pageshow', this.#onPageShow);
        this.#confirmed.stop();
    }

    /**
     * Subscribe to published changes.
     *
     * @returns an unsubscribe function
     */
    onChange(handler: ConnectivityHandler): () => void {
        return this.#confirmed.onChange(handler);
    }

    /**
     * Hint at reachability, such as a request's transport outcome.
     */
    hint(reachable: boolean): void {
        this.#confirmed.hint(reachable);
    }

    /**
     * Probe while the page is visible and stop while it is hidden.
     */
    #follow(): void {
        if (this.#targetDocument.visibilityState === 'hidden') {
            this.#confirmed.stop();
        } else {
            this.#confirmed.start();
        }
    }
}
