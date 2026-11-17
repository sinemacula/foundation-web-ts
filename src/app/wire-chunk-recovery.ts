/**
 * Chunk-load-failure recovery wiring for the bootstrap preset.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Router } from 'vue-router';

import type { ErrorReporter } from '@sinemacula/foundation/reporting/error-reporter';
import { installChunkErrorRecovery } from '../router/chunk-error-recovery';
import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';

/**
 * Options for {@link wireChunkRecovery}.
 */
export interface WireChunkRecoveryOptions {
    /** The router whose navigation errors are inspected and recovered. */
    readonly router: Router;

    /** Per-tab storage recording the last recovery reload; null disables reloading. */
    readonly storage: KeyValueStorage | null;

    /** Receives non-chunk router errors, and chunk errors a reload did not cure. */
    readonly reporter: ErrorReporter;

    /** Whether recovery is installed at all. Default true. */
    readonly enabled?: boolean;

    /** Performs the recovery reload; defaults to a full document navigation. */
    readonly reload?: (path: string) => void;

    /** Resolves the current time; defaults to `Date.now`. */
    readonly clock?: () => number;

    /** The reload-loop guard window in milliseconds. */
    readonly windowMs?: number;
}

/**
 * Wire chunk-load-failure recovery onto the router.
 *
 * @returns the teardown removing the error handler, or null when disabled
 */
export function wireChunkRecovery(options: WireChunkRecoveryOptions): (() => void) | null {
    if (!(options.enabled ?? true)) {
        return null;
    }

    return installChunkErrorRecovery({
        router: options.router,
        storage: options.storage,
        reporter: options.reporter,
        ...(options.reload === undefined ? {} : { reload: options.reload }),
        ...(options.clock === undefined ? {} : { clock: options.clock }),
        ...(options.windowMs === undefined ? {} : { windowMs: options.windowMs }),
    });
}
