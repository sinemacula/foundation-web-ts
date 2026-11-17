/**
 * Unit tests for useFeatureFlag.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { FeatureFlags, FlagsChangeHandler } from '@sinemacula/foundation/feature-flags/feature-flags';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectScope } from 'vue';

import { useFeatureFlag } from '@/composables/use-feature-flag';
import { initialiseFeatureFlags, resetFeatureFlags } from '@/services/feature-flags';

/**
 * A flag provider whose enabled set a test can change and announce.
 */
class ChangingFlags implements FeatureFlags {
    /** The keys currently enabled. */
    enabled = new Set<string>();

    /** The registered change handlers. */
    readonly handlers = new Set<FlagsChangeHandler>();

    /**
     * Report whether the key is in the enabled set.
     */
    isEnabled(key: string): boolean {
        return this.enabled.has(key);
    }

    /**
     * Return the fallback; variants are unused here.
     */
    variant<T>(_key: string, fallback: T): T {
        return fallback;
    }

    /**
     * Ignore the evaluation context.
     */
    setContext(): void {
        return undefined;
    }

    /**
     * Register a change handler and return its unsubscribe.
     */
    onChange(handler: FlagsChangeHandler): () => void {
        this.handlers.add(handler);

        return () => this.handlers.delete(handler);
    }

    /**
     * Replace the enabled set and notify every handler.
     */
    change(enabled: readonly string[]): void {
        this.enabled = new Set(enabled);

        for (const handler of this.handlers) {
            handler();
        }
    }
}

describe('useFeatureFlag', () => {
    let flags: ChangingFlags;

    beforeEach(() => {
        flags = new ChangingFlags();
        initialiseFeatureFlags(flags);
    });

    afterEach(() => {
        resetFeatureFlags();
    });

    it.each([
        ['enabled', ['new-dashboard'], true],
        ['disabled', [], false],
    ])('reads a flag that is %s', (_case, enabled, expected) => {
        flags.enabled = new Set(enabled);

        expect(useFeatureFlag('new-dashboard').value).toBe(expected);
    });

    it('follows provider changes', () => {
        const flag = useFeatureFlag('new-dashboard');

        flags.change(['new-dashboard']);

        expect(flag.value).toBe(true);

        flags.change(['other']);

        expect(flag.value).toBe(false);
    });

    it('stops following changes once its scope is disposed', () => {
        const scope = effectScope();
        const flag = scope.run(() => useFeatureFlag('new-dashboard'));

        scope.stop();
        flags.change(['new-dashboard']);

        expect(flag?.value).toBe(false);
        expect(flags.handlers.size).toBe(0);
    });
});
