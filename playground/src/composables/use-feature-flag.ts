/**
 * Reactive boolean feature flag over the installed flag provider.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Ref } from 'vue';
import { onScopeDispose, readonly, ref } from 'vue';

import { featureFlags } from '@/services/feature-flags';

/**
 * Track whether a boolean flag is enabled, following provider changes until the
 * calling scope is disposed.
 */
export function useFeatureFlag(key: string): Readonly<Ref<boolean>> {
    const flags = featureFlags();
    const enabled = ref(flags.isEnabled(key));
    const unsubscribe = flags.onChange(() => {
        enabled.value = flags.isEnabled(key);
    });

    onScopeDispose(unsubscribe);

    return readonly(enabled);
}
