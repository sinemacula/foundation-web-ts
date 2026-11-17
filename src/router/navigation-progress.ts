/**
 * Reactive flag for whether the router has a navigation in flight.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Ref } from 'vue';
import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { RouteLocation, RouteLocationNormalized, Router } from 'vue-router';

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
 * Track whether `router` has a navigation in flight, ignoring the settling of
 * navigations a newer one superseded; inside an active effect scope, `stop()`
 * also runs when the scope is disposed.
 */
export function createNavigationProgress(router: Router): NavigationProgress {
    const isNavigating = ref(false);
    let latest: RouteLocation | RouteLocationNormalized | null = null;

    /**
     * Clear the flag when `to` belongs to the latest tracked navigation.
     */
    const settle = (to: RouteLocationNormalized): void => {
        if (navigationOf(to) === latest) {
            latest = null;
            isNavigating.value = false;
        }
    };

    const removeBeforeEach = router.beforeEach(to => {
        latest = navigationOf(to);
        isNavigating.value = true;
    });

    const removeAfterEach = router.afterEach(settle);

    const removeOnError = router.onError((_error: unknown, to: RouteLocationNormalized) => {
        settle(to);
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

/**
 * The location that started `to`'s redirect chain, shared by every hop.
 */
function navigationOf(to: RouteLocationNormalized): RouteLocation | RouteLocationNormalized {
    return to.redirectedFrom ?? to;
}
