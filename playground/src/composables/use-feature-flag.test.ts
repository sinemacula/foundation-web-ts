/**
 * Unit tests for useFeatureFlag.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { StaticFeatureFlags } from '@sinemacula/foundation/feature-flags/static-feature-flags';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectScope } from 'vue';

import { useFeatureFlag } from '@/composables/use-feature-flag';
import { initialiseFeatureFlags, resetFeatureFlags } from '@/services/feature-flags';

describe('useFeatureFlag', () => {
    let flags: StaticFeatureFlags;

    beforeEach(() => {
        flags = new StaticFeatureFlags();
        initialiseFeatureFlags(flags);
    });

    afterEach(() => {
        resetFeatureFlags();
    });

    it.each([
        ['enabled', true],
        ['disabled', false],
    ])('reads a flag that is %s', (_case, enabled) => {
        flags.replace({ 'new-dashboard': enabled });

        expect(effectScope().run(() => useFeatureFlag('new-dashboard'))?.value).toBe(enabled);
    });

    it('follows provider changes', () => {
        const flag = effectScope().run(() => useFeatureFlag('new-dashboard'));

        flags.replace({ 'new-dashboard': true });

        expect(flag?.value).toBe(true);

        flags.replace({ other: true });

        expect(flag?.value).toBe(false);
    });

    it('stops following changes once its scope is disposed, leaving other subscribers following', () => {
        const scope = effectScope();
        const disposed = scope.run(() => useFeatureFlag('new-dashboard'));
        const live = effectScope().run(() => useFeatureFlag('new-dashboard'));

        scope.stop();
        flags.replace({ 'new-dashboard': true });

        expect(disposed?.value).toBe(false);
        expect(live?.value).toBe(true);
    });
});
