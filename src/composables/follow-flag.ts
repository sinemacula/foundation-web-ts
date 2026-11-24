/**
 * A read-only ref over a provided flag that announces its changes.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { InjectionKey, Ref } from 'vue';
import { getCurrentScope, inject, onScopeDispose, readonly, shallowRef } from 'vue';

/**
 * A provided service announcing each change of the flag it carries.
 */
export interface FlagSource {
    /**
     * Subscribe to changes, returning the unsubscribe function.
     */
    onChange(handler: (next: boolean) => void): () => void;
}

/**
 * Follow a provided flag from its current state through each change,
 * unsubscribing with the calling scope.
 *
 * @param read - reads the flag's current state from the source
 * @throws the error `unavailable` builds when nothing is provided under the key
 */
export function followProvidedFlag<T extends FlagSource>(
    key: InjectionKey<T>,
    unavailable: () => Error,
    read: (source: T) => boolean,
): Readonly<Ref<boolean>> {
    const source = inject(key, null);

    if (source === null) {
        throw unavailable();
    }

    const value = shallowRef(read(source));
    const unsubscribe = source.onChange(next => {
        value.value = next;
    });

    if (getCurrentScope() !== undefined) {
        onScopeDispose(unsubscribe);
    }

    return readonly(value);
}
