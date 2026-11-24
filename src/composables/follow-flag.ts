/**
 * A read-only ref over a flag that announces its changes.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Ref } from 'vue';
import { getCurrentScope, onScopeDispose, readonly, shallowRef } from 'vue';

/**
 * Follow a flag from its current state through each change, unsubscribing with
 * the calling scope.
 *
 * @param subscribe - registers the change handler and returns its unsubscribe
 */
export function followFlag(
    current: boolean,
    subscribe: (handler: (next: boolean) => void) => () => void,
): Readonly<Ref<boolean>> {
    const value = shallowRef(current);
    const unsubscribe = subscribe(next => {
        value.value = next;
    });

    if (getCurrentScope() !== undefined) {
        onScopeDispose(unsubscribe);
    }

    return readonly(value);
}
