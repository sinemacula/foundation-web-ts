/**
 * First-paint colour-scheme script, run before the kernel module graph loads.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ColorSchemePreference } from '@sinemacula/foundation/theme/color-scheme';
import { COLOR_SCHEME_STORAGE_KEY } from '@sinemacula/foundation/theme/color-scheme';

/**
 * Options for {@link createColorSchemeBootScript}; pass the same values given
 * to the colour-scheme service.
 */
export interface ColorSchemeBootScriptOptions {
    /** The local storage key the preference persists under. Default 'theme'. */
    readonly storageKey?: string;

    /** The preference applied when nothing valid is stored. Default 'system'. */
    readonly defaultPreference?: ColorSchemePreference;
}

/**
 * Build the inline script that resolves the preference the way the
 * colour-scheme service does: a stored `light`, `dark` or `system` wins, and a
 * missing, invalid or unreadable value takes the default. It stamps
 * `[data-theme]` for `light`/`dark` and leaves `system` to CSS
 * `prefers-color-scheme`, so nothing flashes.
 */
export function createColorSchemeBootScript(options: ColorSchemeBootScriptOptions = {}): string {
    const key = toScriptLiteral(options.storageKey ?? COLOR_SCHEME_STORAGE_KEY);
    const fallback = toScriptLiteral(options.defaultPreference ?? 'system');

    return `(function(){var t=null;try{t=localStorage.getItem(${key})}catch(e){}if(t!=='light'&&t!=='dark'&&t!=='system'){t=${fallback}}if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}})()`;
}

/**
 * Serialise `value` as a string literal that cannot close the inline script
 * element it is embedded in.
 */
function toScriptLiteral(value: string): string {
    return JSON.stringify(value).replaceAll('<', String.raw`\u003c`);
}
