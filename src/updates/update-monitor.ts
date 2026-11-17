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
}

const DEFAULT_URL = '/runtime-env.json';
const DEFAULT_INTERVAL = 300_000;

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
     * Runs a check, guarding against throwing subscriber callbacks.
     */
    readonly #poll = (): void => {
        this.checkNow().catch(() => {
            // Only a throwing subscriber reaches here.
        });
    };

    /** The active poll interval handle, or null when stopped. */
    #timer: ReturnType<typeof setInterval> | null = null;

    /** The last version subscribers were notified of. */
    #notifiedVersion: string | null = null;

    constructor(options: UpdateMonitorOptions) {
        this.#currentVersion = options.currentVersion;
        this.#url = options.url ?? DEFAULT_URL;
        this.#interval = options.interval ?? DEFAULT_INTERVAL;
        this.#fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
        this.#extractVersion = options.extractVersion ?? extractAppVersion;
        this.#targetDocument = options.targetDocument ?? globalThis.document;
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
     * Stop polling and detach the visibility listener.
     */
    stop(): void {
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
     * Check the deployed version now, swallowing transport failures and
     * malformed documents since the next tick retries.
     */
    async checkNow(): Promise<void> {
        let next: string | null;

        try {
            const response = await this.#fetchFn(this.#url, {
                cache: 'no-store',
                headers: { accept: 'application/json' },
            });

            if (!response.ok) {
                return;
            }

            next = this.#extractVersion(await response.json());
        } catch {
            return;
        }

        if (next === null || next === '' || next === this.#currentVersion || next === this.#notifiedVersion) {
            return;
        }

        this.#notifiedVersion = next;

        for (const handler of this.#handlers) {
            handler(next);
        }
    }
}

/**
 * Read APP_VERSION from a runtime environment document, or null when absent.
 */
function extractAppVersion(payload: unknown): string | null {
    const version = isRecord(payload) ? payload['APP_VERSION'] : null;

    return typeof version === 'string' ? version : null;
}
