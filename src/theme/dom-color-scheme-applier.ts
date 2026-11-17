/**
 * Applies the colour scheme to `[data-theme]` and the `theme-color` meta tag.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ColorSchemeApplier } from '@sinemacula/foundation/theme/color-scheme-service';
import type { ColorSchemePreference, ResolvedColorScheme } from '@sinemacula/foundation/theme/color-scheme';

const DEFAULT_THEME_COLORS = { light: '#f8fafc', dark: '#0f172a' } as const;

/**
 * A resolved surface-page colour per scheme, for the `theme-color` meta tag.
 */
export interface ThemeColors {
    /** The colour applied in the light scheme. */
    readonly light: string;

    /** The colour applied in the dark scheme. */
    readonly dark: string;
}

/**
 * Construction options for {@link DomColorSchemeApplier}.
 */
export interface DomColorSchemeApplierOptions {
    /** The document whose root and head receive the applied scheme. */
    readonly targetDocument?: Document;

    /** The surface-page colours applied to the `theme-color` meta tag. */
    readonly themeColors?: ThemeColors;
}

/**
 * A {@link ColorSchemeApplier} that stamps the DOM and owns every `theme-color`
 * meta tag.
 */
export class DomColorSchemeApplier implements ColorSchemeApplier {
    /** The document whose root and head receive the applied scheme. */
    readonly #document: Document;

    /** The surface-page colours for the `theme-color` meta tag. */
    readonly #themeColors: ThemeColors;

    constructor(options: DomColorSchemeApplierOptions = {}) {
        this.#document = options.targetDocument ?? globalThis.document;
        this.#themeColors = options.themeColors ?? DEFAULT_THEME_COLORS;
    }

    /**
     * Stamp `[data-theme]`, or clear it for `system` so CSS
     * `prefers-color-scheme` applies, then sync the meta tag.
     */
    apply(resolved: ResolvedColorScheme, preference: ColorSchemePreference): void {
        if (preference === 'system') {
            this.#document.documentElement.removeAttribute('data-theme');
        } else {
            this.#document.documentElement.setAttribute('data-theme', resolved);
        }

        this.#syncMeta(resolved);
    }

    /**
     * Point every `theme-color` meta tag at the resolved surface colour and
     * drop their `media` conditions, so a host's light/dark pair cannot
     * override an explicit choice.
     */
    #syncMeta(resolved: ResolvedColorScheme): void {
        const metas = [...this.#document.querySelectorAll('meta[name="theme-color"]')];

        if (metas.length === 0) {
            const meta = this.#document.createElement('meta');

            meta.setAttribute('name', 'theme-color');
            this.#document.head.appendChild(meta);
            metas.push(meta);
        }

        for (const meta of metas) {
            meta.removeAttribute('media');
            meta.setAttribute('content', this.#themeColors[resolved]);
        }
    }
}
