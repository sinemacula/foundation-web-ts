/**
 * Fatal error boundary that reports a descendant's error and swaps in a panel.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Ref } from 'vue';
import { onErrorCaptured, ref } from 'vue';

import { reporting } from '@/services/reporting';

/**
 * The reactive fatal-boundary state returned by {@link useFatalBoundary}.
 */
export interface FatalBoundary {
    /** `true` once a descendant component has thrown an uncaught error. */
    readonly fatal: Ref<boolean>;

    /**
     * Clear the fatal state, allowing the guarded content to render again.
     */
    reset(): void;
}

/**
 * Install an error boundary around the calling component's descendants; call
 * from `setup()`.
 */
export function useFatalBoundary(): FatalBoundary {
    const fatal = ref(false);

    onErrorCaptured((error: unknown, _instance, info: string) => {
        reporting().captureError(error, { source: 'fatal-boundary', info });
        fatal.value = true;

        // Stop propagation so the global handler does not report it again.
        return false;
    });

    /**
     * Clear the fatal state.
     */
    function reset(): void {
        fatal.value = false;
    }

    return { fatal, reset };
}
