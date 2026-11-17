/**
 * Reactive flag for whether the router has a navigation in flight.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Ref } from 'vue';
import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { Router } from 'vue-router';

/**
 * The reactive navigation-progress state returned by
 * {@link createNavigationProgress}.
 */
export interface NavigationProgress {
    /** `true` while a navigation is in flight. */
    readonly isNavigating: Ref<boolean>;

    /**
     * Remove the router hooks and reset `isNavigating` to false.
     */
    stop(): void;
}

/**
 * Track whether `router` has a navigation in flight; inside an active effect
 * scope, `stop()` also runs when the scope is disposed.
 */
export function createNavigationProgress(router: Router): NavigationProgress {
    const isNavigating = ref(false);

    const removeBeforeEach = router.beforeEach(() => {
        isNavigating.value = true;
    });

    const removeAfterEach = router.afterEach(() => {
        isNavigating.value = false;
    });

    const removeOnError = router.onError(() => {
        isNavigating.value = false;
    });

    /**
     * Remove the navigation hooks and reset `isNavigating` to false.
     */
    function stop(): void {
        removeBeforeEach();
        removeAfterEach();
        removeOnError();
        isNavigating.value = false;
    }

    if (getCurrentScope() !== undefined) {
        onScopeDispose(stop);
    }

    return { isNavigating, stop };
}
