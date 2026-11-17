/**
 * Unit tests for color-scheme-boot.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import type { ColorSchemePreference } from '@sinemacula/foundation/theme/color-scheme';
import { ColorSchemeService } from '@sinemacula/foundation/theme/color-scheme-service';
import { createColorSchemeBootScript } from './color-scheme-boot';

/** Run `script` against storage holding `stored` under `key`; return the stamped scheme. */
function runBootScript(script: string, key: string, stored: string | null, throwOnRead = false): string | null {
    let applied: string | null = null;

    const localStorage = {
        getItem(requested: string): string | null {
            if (throwOnRead) {
                throw new DOMException('denied', 'SecurityError');
            }

            return requested === key ? stored : null;
        },
    };

    const documentStub = {
        documentElement: {
            setAttribute(name: string, value: string): void {
                if (name === 'data-theme') {
                    applied = value;
                }
            },
        },
    };

    new Function('localStorage', 'document', script)(localStorage, documentStub);

    return applied;
}

/** The preference a colour-scheme service resolves from `stored` under `key`. */
function servicePreference(key: string, stored: string | null, fallback: ColorSchemePreference): string {
    const storage = new MemoryStorage();

    if (stored !== null) {
        storage.set(key, stored);
    }

    return new ColorSchemeService({
        storage,
        storageKey: key,
        defaultPreference: fallback,
        source: { prefersDark: () => false, subscribe: () => () => undefined },
        applier: { apply: () => undefined },
    }).preference();
}

const STORED = ['light', 'dark', 'system', null, 'purple'] as const;
const DEFAULTS = ['light', 'dark', 'system'] as const;

describe('color-scheme-boot', () => {
    describe('createColorSchemeBootScript', () => {
        it.each(STORED.flatMap(stored => DEFAULTS.map(fallback => [stored, fallback] as const)))(
            'stamps what the service resolves for stored %s with default %s',
            (stored, fallback) => {
                const script = createColorSchemeBootScript({ storageKey: 'app.scheme', defaultPreference: fallback });
                const preference = servicePreference('app.scheme', stored, fallback);

                expect(runBootScript(script, 'app.scheme', stored)).toBe(preference === 'system' ? null : preference);
            },
        );

        it('reads only the configured key', () => {
            const script = createColorSchemeBootScript({ storageKey: 'app.scheme' });

            expect(runBootScript(script, 'theme', 'dark')).toBeNull();
            expect(runBootScript(script, 'app.scheme', 'dark')).toBe('dark');
        });

        it('applies the default when storage access is refused', () => {
            const script = createColorSchemeBootScript({ defaultPreference: 'dark' });

            expect(runBootScript(script, 'theme', 'light', true)).toBe('dark');
        });

        it('cannot close the inline script element through the storage key', () => {
            const script = createColorSchemeBootScript({ storageKey: '</script><script>alert(1)//' });

            expect(script).not.toContain('</script>');
            expect(runBootScript(script, '</script><script>alert(1)//', 'dark')).toBe('dark');
        });
    });

    describe('default script', () => {
        it.each(['dark', 'light'])('stamps data-theme for a stored %s preference', stored => {
            expect(runBootScript(createColorSchemeBootScript(), 'theme', stored)).toBe(stored);
        });

        it.each(['system', null, 'purple'])('does not stamp for a stored %s value', stored => {
            expect(runBootScript(createColorSchemeBootScript(), 'theme', stored)).toBeNull();
        });

        it('swallows a throwing storage read', () => {
            expect(runBootScript(createColorSchemeBootScript(), 'theme', 'dark', true)).toBeNull();
        });

        it.each(['playground/index.html', 'playground/scripts/generate-error-pages.mjs'])(
            'is the script %s inlines',
            path => {
                expect(readFileSync(resolve(process.cwd(), path), 'utf8')).toContain(createColorSchemeBootScript());
            },
        );
    });
});
