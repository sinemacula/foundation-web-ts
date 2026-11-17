/**
 * Reactive feature-flag composables over one shared subscription per flag set.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ComputedRef, ShallowRef } from 'vue';
import { computed, shallowRef, triggerRef } from 'vue';

import type { FeatureFlags, FlagValue } from '@sinemacula/foundation/feature-flags/feature-flags';

const revisions = new WeakMap<FeatureFlags, ShallowRef<null>>();

/**
 * Return a computed boolean flag that re-evaluates whenever the flag set
 * changes.
 *
 * Safe outside an effect scope: every composable over the same flag set shares
 * one change subscription held for the flag set's lifetime.
 *
 * @param fallback - returned when the flag is absent or non-boolean
 */
export function useFeatureFlag(flags: FeatureFlags, key: string, fallback = false): ComputedRef<boolean> {
    const revision = flagSetRevision(flags);

    return computed(() => {
        revision.value;

        return flags.isEnabled(key, fallback);
    });
}

/**
 * Return a computed string variant that re-evaluates whenever the flag set
 * changes; a missing key or a value of another type resolves to the fallback.
 *
 * Safe outside an effect scope: every composable over the same flag set shares
 * one change subscription held for the flag set's lifetime.
 */
export function useVariant(flags: FeatureFlags, key: string, fallback: string): ComputedRef<string>;

/**
 * Return a computed numeric variant that re-evaluates whenever the flag set
 * changes; a missing key or a value of another type resolves to the fallback.
 */
export function useVariant(flags: FeatureFlags, key: string, fallback: number): ComputedRef<number>;

/**
 * Return a computed boolean variant that re-evaluates whenever the flag set
 * changes; a missing key or a value of another type resolves to the fallback.
 */
export function useVariant(flags: FeatureFlags, key: string, fallback: boolean): ComputedRef<boolean>;

/**
 * Return a computed variant narrowed to an explicit `Value`. The narrowing is
 * unchecked: only the runtime type is compared with the fallback's.
 */
export function useVariant<Value extends FlagValue = FlagValue>(
    flags: FeatureFlags,
    key: string,
    fallback: NoInfer<Value>,
): ComputedRef<NoInfer<Value>>;

/**
 * Resolve the variant through the flag set on every change.
 */
export function useVariant(flags: FeatureFlags, key: string, fallback: FlagValue): ComputedRef<FlagValue> {
    const revision = flagSetRevision(flags);

    return computed(() => {
        revision.value;

        return flags.variant(key, fallback);
    });
}

/**
 * Return the ref triggered on every change of the flag set, subscribing on
 * first use.
 */
function flagSetRevision(flags: FeatureFlags): ShallowRef<null> {
    const existing = revisions.get(flags);

    if (existing !== undefined) {
        return existing;
    }

    const revision = shallowRef(null);

    flags.onChange(() => triggerRef(revision));
    revisions.set(flags, revision);

    return revision;
}
