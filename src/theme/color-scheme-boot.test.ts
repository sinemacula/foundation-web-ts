/**
 * Unit tests for color-scheme-boot.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it } from 'vitest';

import { COLOR_SCHEME_BOOT_SCRIPT } from './color-scheme-boot';

/** Run the boot script against stubbed storage; return the applied scheme. */
function runBootScript(stored: string | null, throwOnRead = false): string | null {
    let applied: string | null = null;

    const localStorage = {
        getItem(key: string): string | null {
            if (throwOnRead) {
                throw new Error('storage unavailable');
            }

            return key === 'theme' ? stored : null;
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

    const boot = new Function('localStorage', 'document', COLOR_SCHEME_BOOT_SCRIPT);

    boot(localStorage, documentStub);

    return applied;
}

describe('color-scheme-boot', () => {
    describe('COLOR_SCHEME_BOOT_SCRIPT', () => {
        it('is the exact self-contained boot string for the theme key', () => {
            expect(COLOR_SCHEME_BOOT_SCRIPT).toBe(
                "try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}",
            );
        });

        it.each(['dark', 'light'])('stamps data-theme for a stored %s preference', stored => {
            expect(runBootScript(stored)).toBe(stored);
        });

        it.each(['system', null, 'purple'])('does not stamp for a stored %s value', stored => {
            expect(runBootScript(stored)).toBeNull();
        });

        it('swallows a throwing storage read', () => {
            expect(runBootScript('dark', true)).toBeNull();
        });
    });
});
