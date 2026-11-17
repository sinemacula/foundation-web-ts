/**
 * Router recovery from the chunk-load failures a stale deploy leaves behind.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { RouteLocationNormalized, Router } from 'vue-router';

import type { ErrorReporter } from '@sinemacula/foundation/reporting/error-reporter';
import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';
import { BrowserStorage } from '../storage/browser-storage';

const CHUNK_ERROR_MESSAGE_PATTERN =
    /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css/i;
const DEFAULT_WINDOW_MS = 60_000;
const STORAGE_KEY = 'chunk-recovery.reloaded-at';

/**
 * Options for installing chunk-load-failure recovery on a router.
 */
export interface ChunkErrorRecoveryOptions {
    /** The router whose navigation errors are inspected and recovered. */
    readonly router: Router;

    /** Per-tab storage surviving a reload that records the last recovery; null or unwritable storage disables reloading. */
    readonly storage: KeyValueStorage | null;

    /** Receives non-chunk router errors, and chunk errors a reload did not cure. */
    readonly reporter?: ErrorReporter;

    /** Performs the recovery reload; defaults to a full document load of the router's URL for `targetPath`. */
    readonly reload?: (targetPath: string) => void;

    /** Resolves the current epoch milliseconds; defaults to `Date.now`. */
    readonly clock?: () => number;

    /** The reload-loop guard window in milliseconds; defaults to sixty seconds. */
    readonly windowMs?: number;
}

/**
 * Install a router error handler that reloads the document on a chunk-load
 * failure at most once per tab within `windowMs`, and reports every other
 * router error, including a chunk failure it could not or would not reload;
 * the handler never throws, so later error listeners still run.
 *
 * @returns a teardown that removes the error handler
 */
export function installChunkErrorRecovery(options: ChunkErrorRecoveryOptions): () => void {
    const { router, storage, reporter } = options;
    const reload = options.reload ?? ((targetPath: string): void => reloadDocument(router.resolve(targetPath).href));
    const clock = options.clock ?? Date.now;
    const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;

    /**
     * Reload for a recoverable chunk failure; report anything else.
     */
    const recover = (error: unknown, targetPath: string): void => {
        if (!isChunkLoadError(error) || storage === null) {
            report(reporter, error, targetPath);
            return;
        }

        const now = clock();
        const lastReloadAt = Number(storage.get(STORAGE_KEY) ?? Number.NaN);
        const elapsed = now - lastReloadAt;

        if (elapsed >= 0 && elapsed < windowMs) {
            report(reporter, error, targetPath);
            return;
        }

        storage.set(STORAGE_KEY, String(now));

        if (storage.get(STORAGE_KEY) !== String(now)) {
            report(reporter, error, targetPath);
            return;
        }

        reload(targetPath);
    };

    return router.onError((error: unknown, to: RouteLocationNormalized) => {
        try {
            recover(error, to.fullPath);
        } catch {
            report(reporter, error, to.fullPath);
        }
    });
}

/**
 * Whether `error` is the browser's dynamic-import failure for a missing chunk,
 * or the bundler's failure to preload a missing stylesheet.
 */
export function isChunkLoadError(error: unknown): boolean {
    return error instanceof Error && CHUNK_ERROR_MESSAGE_PATTERN.test(error.message);
}

/**
 * The tab's session storage for the recovery guard, or null when the browser
 * refuses access to it.
 */
export function tabRecoveryStorage(targetWindow: Window): KeyValueStorage | null {
    try {
        return new BrowserStorage(targetWindow.sessionStorage);
    } catch {
        return null;
    }
}

/**
 * Hand `error` to the reporter, falling back to the console when the reporter
 * itself throws.
 */
function report(reporter: ErrorReporter | undefined, error: unknown, path: string): void {
    try {
        reporter?.captureError(error, { source: 'router', path });
    } catch {
        console.error(error);
    }
}

/**
 * Load `href` as a full document so the browser fetches the current
 * `index.html` and the chunks it references; a target differing from the
 * current URL only by fragment would not reload, so it is reloaded explicitly.
 */
function reloadDocument(href: string): void {
    const location = globalThis.location;
    const current = new URL(location.href);
    const target = new URL(href, current);
    const sameDocument = target.pathname === current.pathname && target.search === current.search;

    location.assign(target.href);

    if (sameDocument && target.hash !== '') {
        location.reload();
    }
}
