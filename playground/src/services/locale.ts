/**
 * Locale switcher accessors; `resetLocaleSwitcher` clears every kernel holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export {
    installLocaleSwitcher as initialiseLocaleSwitcher,
    localeSwitcher,
    resetWebCoreServices as resetLocaleSwitcher,
} from '@sinemacula/web-core/app/services';
