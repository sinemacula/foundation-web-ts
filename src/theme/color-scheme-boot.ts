/**
 * First-paint colour-scheme script, run before the kernel module graph loads.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { COLOR_SCHEME_STORAGE_KEY } from '@sinemacula/foundation/theme/color-scheme';

/**
 * Inline script stamping `[data-theme]` for a stored `light`/`dark` choice;
 * anything else is left to CSS `prefers-color-scheme`, so nothing flashes.
 */
export const COLOR_SCHEME_BOOT_SCRIPT = `try{var t=localStorage.getItem('${COLOR_SCHEME_STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}`;
