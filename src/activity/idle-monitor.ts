/**
 * User-idle detection; the idle policy (logout, warning) is left to the app.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export interface IdleMonitorOptions {
    /** Milliseconds of inactivity before subscribers are notified. */
    readonly timeoutMs: number;

    /** Event types treated as activity; defaults to pointer, keyboard, wheel and touch input. */
    readonly events?: readonly string[];

    /** The window whose activity events are observed; defaults to the global window. */
    readonly targetWindow?: Window;

    /** Receives an error thrown by a subscriber, which never stops the others; defaults to the global `reportError`. */
    readonly onError?: (error: unknown) => void;
}

const DEFAULT_EVENTS: readonly string[] = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

/**
 * Detects periods of user inactivity and notifies subscribers once idle.
 */
export class IdleMonitor {
    /** Milliseconds of inactivity before subscribers are notified. */
    readonly #timeoutMs: number;

    /** The event types treated as user activity. */
    readonly #events: readonly string[];

    /** The window whose activity events are observed. */
    readonly #targetWindow: Window;

    /** The registered idle subscribers. */
    readonly #handlers = new Set<() => void>();

    /** Receives errors thrown by subscribers. */
    readonly #onError: (error: unknown) => void;

    /**
     * Rearms the countdown when activity is observed.
     */
    readonly #onActivity = (): void => {
        this.#rearm();
    };

    /**
     * Notifies subscribers once the countdown lapses.
     */
    readonly #onTimeout = (): void => {
        this.#timer = null;

        for (const handler of this.#handlers) {
            try {
                handler();
            } catch (error) {
                this.#report(error);
            }
        }
    };

    /** The pending idle timeout handle, or null when disarmed. */
    #timer: ReturnType<typeof setTimeout> | null = null;

    /** Whether the monitor is currently running. */
    #started: boolean = false;

    constructor(options: IdleMonitorOptions) {
        this.#timeoutMs = options.timeoutMs;
        this.#events = options.events ?? DEFAULT_EVENTS;
        this.#targetWindow = options.targetWindow ?? globalThis.window;
        this.#onError = options.onError ?? (error => globalThis.reportError(error));
    }

    /**
     * Arm the idle countdown and attach activity listeners; no-op when running.
     */
    start(): void {
        if (this.#started) {
            return;
        }

        this.#started = true;

        for (const type of this.#events) {
            this.#targetWindow.addEventListener(type, this.#onActivity);
        }

        this.#arm();
    }

    /**
     * Disarm the countdown and detach the activity listeners.
     */
    stop(): void {
        if (!this.#started) {
            return;
        }

        this.#started = false;

        for (const type of this.#events) {
            this.#targetWindow.removeEventListener(type, this.#onActivity);
        }

        this.#disarm();
    }

    /**
     * Signal activity manually, resetting the countdown.
     */
    touch(): void {
        this.#rearm();
    }

    /**
     * Subscribe to idle notifications, once per idle period.
     *
     * @returns an unsubscribe function
     */
    onIdle(handler: () => void): () => void {
        this.#handlers.add(handler);

        return () => {
            this.#handlers.delete(handler);
        };
    }

    /**
     * Reset the countdown to a fresh timeout, unless the monitor is stopped.
     */
    #rearm(): void {
        if (!this.#started) {
            return;
        }

        this.#disarm();
        this.#arm();
    }

    /**
     * Schedule the idle timeout.
     */
    #arm(): void {
        this.#timer = setTimeout(this.#onTimeout, this.#timeoutMs);
    }

    /**
     * Cancel the pending timeout when one is scheduled.
     */
    #disarm(): void {
        if (this.#timer !== null) {
            clearTimeout(this.#timer);
            this.#timer = null;
        }
    }

    /**
     * Pass a subscriber's error to the sink, ignoring a throwing sink.
     */
    #report(error: unknown): void {
        try {
            this.#onError(error);
        } catch {
            // The sink is the last resort; nothing is left to report to.
        }
    }
}
