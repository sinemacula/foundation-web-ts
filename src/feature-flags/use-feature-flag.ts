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
 * Return a computed variant that re-evaluates whenever the flag set changes.
 *
 * Safe outside an effect scope: every composable over the same flag set shares
 * one change subscription held for the flag set's lifetime.
 *
 * @param fallback - returned when the flag is absent or the wrong type; its
 * type pins the return type
 */
export function useVariant<Value extends FlagValue>(
    flags: FeatureFlags,
    key: string,
    fallback: Value,
): ComputedRef<Value> {
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
