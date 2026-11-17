/**
 * Reactive feature-flag composables, unsubscribed when their effect scope ends.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ComputedRef } from 'vue';
import { computed, onScopeDispose, ref } from 'vue';

import type { FeatureFlags, FlagValue } from '@sinemacula/foundation/feature-flags/feature-flags';

/**
 * Return a computed boolean flag that re-evaluates whenever the flag set
 * changes.
 *
 * @param fallback - returned when the flag is absent or non-boolean
 */
export function useFeatureFlag(flags: FeatureFlags, key: string, fallback = false): ComputedRef<boolean> {
    const tick = ref(0);

    const unsubscribe = flags.onChange(() => {
        tick.value += 1;
    });

    onScopeDispose(unsubscribe);

    return computed(() => {
        // Depend on tick so flag-set changes re-evaluate.
        tick.value;

        return flags.isEnabled(key, fallback);
    });
}

/**
 * Return a computed variant that re-evaluates whenever the flag set changes.
 *
 * @param fallback - returned when the flag is absent or the wrong type; its
 * type pins the return type
 */
export function useVariant<Value extends FlagValue>(
    flags: FeatureFlags,
    key: string,
    fallback: Value,
): ComputedRef<Value> {
    const tick = ref(0);

    const unsubscribe = flags.onChange(() => {
        tick.value += 1;
    });

    onScopeDispose(unsubscribe);

    return computed(() => {
        // Depend on tick so flag-set changes re-evaluate.
        tick.value;

        return flags.variant(key, fallback);
    });
}
