/**
 * Toast accessors; `resetToasts` clears every kernel service holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export {
    installToasts as initialiseToasts,
    resetFoundationWebServices as resetToasts,
    toasts,
} from '@sinemacula/foundation-web/app/services';
