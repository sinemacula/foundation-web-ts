/**
 * Polls the deployed version, since static deploys cannot push new releases.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { isRecord } from '@sinemacula/foundation/support/is-record';

export type UpdateHandler = (nextVersion: string) => void;

export interface UpdateMonitorOptions {
    /** The version the running application was booted with. */
    readonly currentVersion: string;

    /** The version document location; defaults to the runtime environment document. */
    readonly url?: string;

    /** Poll interval in milliseconds; defaults to five minutes. */
    readonly interval?: number;

    /** The fetch implementation to use; defaults to the global fetch. */
    readonly fetchFn?: typeof fetch;

    /** Extract the deployed version from the parsed document; defaults to the APP_VERSION entry. */
    readonly extractVersion?: (payload: unknown) => string | null;

    /** The document whose visibility triggers focus checks; defaults to the global document. */
    readonly targetDocument?: Document;

    /** Milliseconds before a check is abandoned; defaults to ten seconds. */
    readonly timeout?: number;

    /** Receives an error thrown by a subscriber, which never stops the others; defaults to the global `reportError`. */
    readonly onError?: (error: unknown) => void;
}

const DEFAULT_URL = '/runtime-env.json';
const DEFAULT_INTERVAL = 300_000;
const DEFAULT_TIMEOUT = 10_000;

/**
 * Polls on an interval and on tab focus, notifying once per new version.
 */
export class UpdateMonitor {
    /** The version the running application was booted with. */
    readonly #currentVersion: string;

    /** The version document location that is polled. */
    readonly #url: string;

    /** The poll interval in milliseconds. */
    readonly #interval: number;

    /** The fetch implementation used to retrieve the version document. */
    readonly #fetchFn: typeof fetch;

    /** Extracts the deployed version from the parsed document. */
    readonly #extractVersion: (payload: unknown) => string | null;

    /** The document whose visibility triggers focus checks. */
    readonly #targetDocument: Document;

    /** Milliseconds before a check is abandoned. */
    readonly #timeout: number;

    /** Receives errors thrown by subscribers. */
    readonly #onError: (error: unknown) => void;

    /** The registered update subscribers. */
    readonly #handlers = new Set<UpdateHandler>();

    /**
     * Polls when the tab regains visibility.
     */
    readonly #onVisibilityChange = (): void => {
        if (this.#targetDocument.visibilityState === 'visible') {
            this.#poll();
        }
    };

    /**
     * Runs a check in the background.
     */
    readonly #poll = (): void => {
        void this.checkNow();
    };

    /** The active poll interval handle, or null when stopped. */
    #timer: ReturnType<typeof setInterval> | null = null;

    /** The last version subscribers were notified of. */
    #notifiedVersion: string | null = null;

    /** The check in flight and the controller that abandons it, or null when idle. */
    #inFlight: { readonly promise: Promise<void>; readonly controller: AbortController } | null = null;

    constructor(options: UpdateMonitorOptions) {
        this.#currentVersion = options.currentVersion;
        this.#url = options.url ?? DEFAULT_URL;
        this.#interval = options.interval ?? DEFAULT_INTERVAL;
        this.#fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
        this.#extractVersion = options.extractVersion ?? extractAppVersion;
        this.#targetDocument = options.targetDocument ?? globalThis.document;
        this.#timeout = options.timeout ?? DEFAULT_TIMEOUT;
        this.#onError = options.onError ?? (error => globalThis.reportError(error));
    }

    /**
     * Begin polling; no-op when running.
     */
    start(): void {
        if (this.#timer !== null) {
            return;
        }

        this.#timer = setInterval(this.#poll, this.#interval);

        this.#targetDocument.addEventListener('visibilitychange', this.#onVisibilityChange);
    }

    /**
     * Stop polling, abandon any check in flight so it never notifies, and
     * detach the visibility listener.
     */
    stop(): void {
        this.#inFlight?.controller.abort();
        this.#inFlight = null;

        if (this.#timer === null) {
            return;
        }

        clearInterval(this.#timer);
        this.#timer = null;

        this.#targetDocument.removeEventListener('visibilitychange', this.#onVisibilityChange);
    }

    /**
     * Subscribe to newly deployed versions.
     *
     * @returns an unsubscribe function
     */
    onUpdate(handler: UpdateHandler): () => void {
        this.#handlers.add(handler);

        return () => {
            this.#handlers.delete(handler);
        };
    }

    /**
     * Check the deployed version now, joining a check already in flight.
     * Transport failures, timeouts and malformed documents are swallowed since
     * the next tick retries.
     */
    checkNow(): Promise<void> {
        if (this.#inFlight !== null) {
            return this.#inFlight.promise;
        }

        const controller = new AbortController();
        const promise = this.#check(controller).finally(() => {
            if (this.#inFlight?.controller === controller) {
                this.#inFlight = null;
            }
        });

        this.#inFlight = { promise, controller };

        return promise;
    }

    /**
     * Fetch and compare the deployed version, giving up once `controller`
     * aborts on timeout or stop, even if the fetch ignores its signal.
     */
    async #check(controller: AbortController): Promise<void> {
        const timer = setTimeout(() => controller.abort(), this.#timeout);
        const next = await Promise.race([this.#fetchVersion(controller.signal), whenAborted(controller.signal)]);

        clearTimeout(timer);

        if (controller.signal.aborted || next === null || next === '') {
            return;
        }

        if (next === this.#currentVersion || next === this.#notifiedVersion) {
            return;
        }

        this.#notifiedVersion = next;

        for (const handler of this.#handlers) {
            try {
                handler(next);
            } catch (error) {
                this.#report(error);
            }
        }
    }

    /**
     * Fetch the version document and extract its version, or null on any
     * failure.
     */
    async #fetchVersion(signal: AbortSignal): Promise<string | null> {
        try {
            const response = await this.#fetchFn(this.#url, {
                cache: 'no-store',
                headers: { accept: 'application/json' },
                signal,
            });

            return response.ok ? this.#extractVersion(await response.json()) : null;
        } catch {
            return null;
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

/**
 * Resolve null once `signal` aborts.
 */
function whenAborted(signal: AbortSignal): Promise<null> {
    return new Promise(resolve => {
        signal.addEventListener('abort', () => resolve(null), { once: true });
    });
}

/**
 * Read APP_VERSION from a runtime environment document, or null when absent.
 */
function extractAppVersion(payload: unknown): string | null {
    const version = isRecord(payload) ? payload['APP_VERSION'] : null;

    return typeof version === 'string' ? version : null;
}
