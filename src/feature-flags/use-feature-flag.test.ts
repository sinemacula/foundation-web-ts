/**
 * Unit tests for useFeatureFlag and useVariant composables.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { ComputedRef } from 'vue';
import { effectScope } from 'vue';

import type { FlagValue } from '@sinemacula/foundation/feature-flags/feature-flags';
import { StaticFeatureFlags } from '@sinemacula/foundation/feature-flags/static-feature-flags';
import { useFeatureFlag, useVariant } from './use-feature-flag';

describe('useFeatureFlag', () => {
    it('returns the current boolean value of the flag', () => {
        const flags = new StaticFeatureFlags({ 'feat-a': true });

        const scope = effectScope();
        const result = scope.run(() => useFeatureFlag(flags, 'feat-a'));

        expect(result?.value).toBe(true);

        scope.stop();
    });

    it('defaults to false when the flag is absent and no fallback is given', () => {
        const flags = new StaticFeatureFlags();

        const scope = effectScope();
        const result = scope.run(() => useFeatureFlag(flags, 'missing'));

        expect(result?.value).toBe(false);

        scope.stop();
    });

    it('uses the explicit fallback when the flag is absent', () => {
        const flags = new StaticFeatureFlags();

        const scope = effectScope();
        const result = scope.run(() => useFeatureFlag(flags, 'missing', true));

        expect(result?.value).toBe(true);

        scope.stop();
    });

    it('updates reactively when the flag set is replaced', () => {
        const flags = new StaticFeatureFlags({ 'feat-a': false });

        const scope = effectScope();
        const result = scope.run(() => useFeatureFlag(flags, 'feat-a'));

        expect(result?.value).toBe(false);

        flags.replace({ 'feat-a': true });

        expect(result?.value).toBe(true);

        scope.stop();
    });

    it('stays reactive without a warning outside an effect scope', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const flags = new StaticFeatureFlags({ 'feat-a': false });
        const result = useFeatureFlag(flags, 'feat-a');

        expect(result.value).toBe(false);

        flags.replace({ 'feat-a': true });

        expect(result.value).toBe(true);
        expect(warn).not.toHaveBeenCalled();

        warn.mockRestore();
    });
});

describe('useVariant', () => {
    it('returns the current string variant value', () => {
        const flags = new StaticFeatureFlags({ flow: 'checkout-v2' });

        const scope = effectScope();
        const result = scope.run(() => useVariant(flags, 'flow', 'checkout-v1'));

        expect(result?.value).toBe('checkout-v2');

        scope.stop();
    });

    it('returns the current number variant value', () => {
        const flags = new StaticFeatureFlags({ limit: 100 });

        const scope = effectScope();
        const result = scope.run(() => useVariant(flags, 'limit', 0));

        expect(result?.value).toBe(100);

        scope.stop();
    });

    it('returns the current boolean variant value', () => {
        const flags = new StaticFeatureFlags({ compact: true });

        expect(useVariant(flags, 'compact', false).value).toBe(true);
    });

    it('returns the fallback when the stored value has another type', () => {
        const flags = new StaticFeatureFlags({ limit: '100' });

        expect(useVariant(flags, 'limit', 0).value).toBe(0);
    });

    it('widens a literal fallback to its primitive type', () => {
        const flags = new StaticFeatureFlags();

        expectTypeOf(useVariant(flags, 'flow', 'checkout-v1')).toEqualTypeOf<ComputedRef<string>>();
        expectTypeOf(useVariant(flags, 'limit', 0)).toEqualTypeOf<ComputedRef<number>>();
        expectTypeOf(useVariant(flags, 'compact', false)).toEqualTypeOf<ComputedRef<boolean>>();
        expectTypeOf(useVariant(flags, 'mixed', 0 as FlagValue)).toEqualTypeOf<ComputedRef<FlagValue>>();
    });

    it('does not narrow from the expected result type', () => {
        const flags = new StaticFeatureFlags();
        // @ts-expect-error a literal fallback resolves to a plain string
        const result: ComputedRef<'checkout-v1'> = useVariant(flags, 'flow', 'checkout-v1');

        expect(result.value).toBe('checkout-v1');
    });

    it('narrows to an explicit variant type', () => {
        const flags = new StaticFeatureFlags({ flow: 'checkout-v2' });
        const result = useVariant<'checkout-v1' | 'checkout-v2'>(flags, 'flow', 'checkout-v1');

        expectTypeOf(result).toEqualTypeOf<ComputedRef<'checkout-v1' | 'checkout-v2'>>();
        expect(result.value).toBe('checkout-v2');
    });

    it('returns the fallback when the key is absent', () => {
        const flags = new StaticFeatureFlags();

        const scope = effectScope();
        const result = scope.run(() => useVariant(flags, 'missing', 'default'));

        expect(result?.value).toBe('default');

        scope.stop();
    });

    it('updates reactively when the flag set is replaced', () => {
        const flags = new StaticFeatureFlags({ flow: 'checkout-v1' });

        const scope = effectScope();
        const result = scope.run(() => useVariant(flags, 'flow', 'checkout-v1'));

        expect(result?.value).toBe('checkout-v1');

        flags.replace({ flow: 'checkout-v2' });

        expect(result?.value).toBe('checkout-v2');

        scope.stop();
    });

    it('stays reactive without a warning outside an effect scope', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const flags = new StaticFeatureFlags({ flow: 'checkout-v1' });
        const result = useVariant(flags, 'flow', 'checkout-v1');

        expect(result.value).toBe('checkout-v1');

        flags.replace({ flow: 'checkout-v2' });

        expect(result.value).toBe('checkout-v2');
        expect(warn).not.toHaveBeenCalled();

        warn.mockRestore();
    });
});

describe('flag-set subscription', () => {
    it('subscribes once per flag set however many composables read it', () => {
        const flags = new StaticFeatureFlags({ 'feat-a': false, flow: 'checkout-v1' });
        const onChange = vi.spyOn(flags, 'onChange');
        const flag = useFeatureFlag(flags, 'feat-a');
        const variant = useVariant(flags, 'flow', 'checkout-v1');

        useFeatureFlag(flags, 'feat-b');

        expect(onChange).toHaveBeenCalledOnce();
        expect(flag.value).toBe(false);
        expect(variant.value).toBe('checkout-v1');

        flags.replace({ 'feat-a': true, flow: 'checkout-v2' });

        expect(flag.value).toBe(true);
        expect(variant.value).toBe('checkout-v2');
    });

    it('subscribes separately to each flag set', () => {
        const first = new StaticFeatureFlags({ 'feat-a': false });
        const second = new StaticFeatureFlags({ 'feat-a': false });
        const fromFirst = useFeatureFlag(first, 'feat-a');
        const fromSecond = useFeatureFlag(second, 'feat-a');

        expect(fromFirst.value).toBe(false);
        expect(fromSecond.value).toBe(false);

        second.replace({ 'feat-a': true });

        expect(fromFirst.value).toBe(false);
        expect(fromSecond.value).toBe(true);
    });
});
