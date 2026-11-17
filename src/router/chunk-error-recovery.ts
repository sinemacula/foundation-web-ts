/**
 * Router recovery from the chunk-load failures a stale deploy leaves behind.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Router } from 'vue-router';

import type { ErrorReporter } from '@sinemacula/foundation/reporting/error-reporter';
import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';

const CHUNK_ERROR_MESSAGE_PATTERN =
    /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i;
const DEFAULT_WINDOW_MS = 60_000;
const STORAGE_KEY_PREFIX = 'chunk-recovery.';

/**
 * Options for installing chunk-load-failure recovery on a router.
 */
export interface ChunkErrorRecoveryOptions {
    /** The router whose navigation errors are inspected and recovered. */
    readonly router: Router;

    /** Records the last recovery attempt per path, guarding against reload loops. */
    readonly storage: KeyValueStorage;

    /** Receives non-chunk router errors, and chunk errors a reload did not cure. */
    readonly reporter?: ErrorReporter;

    /** Performs the recovery reload; defaults to a full document navigation to `targetPath`. */
    readonly reload?: (targetPath: string) => void;

    /** Resolves the current epoch milliseconds; defaults to `Date.now`. */
    readonly clock?: () => number;

    /** The reload-loop guard window in milliseconds; defaults to sixty seconds. */
    readonly windowMs?: number;
}

/**
 * Install a router error handler that reloads the document on a chunk-load
 * failure, at most once per path within `windowMs`, and reports every other
 * router error, including a chunk failure the reload did not cure.
 *
 * @returns a teardown that removes the error handler
 */
export function installChunkErrorRecovery(options: ChunkErrorRecoveryOptions): () => void {
    const { router, storage, reporter } = options;
    const reload = options.reload ?? defaultReload;
    const clock = options.clock ?? Date.now;
    const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;

    return router.onError((error: unknown, to) => {
        const targetPath = to.fullPath;

        if (!isChunkLoadError(error)) {
            reporter?.captureError(error, { source: 'router', path: targetPath });
            return;
        }

        const key = STORAGE_KEY_PREFIX + targetPath;
        const lastReloadAt = storage.get(key);
        const now = clock();

        if (lastReloadAt !== null && now - Number(lastReloadAt) < windowMs) {
            reporter?.captureError(error, { source: 'router', path: targetPath });
            return;
        }

        storage.set(key, String(now));
        reload(targetPath);
    });
}

/**
 * Whether `error` is the browser's dynamic-import failure for a missing chunk.
 */
export function isChunkLoadError(error: unknown): boolean {
    return error instanceof Error && CHUNK_ERROR_MESSAGE_PATTERN.test(error.message);
}

/**
 * Load `targetPath` as a full document so the browser fetches the current
 * `index.html` and the chunks it references.
 */
function defaultReload(targetPath: string): void {
    globalThis.location.href = targetPath;
}
