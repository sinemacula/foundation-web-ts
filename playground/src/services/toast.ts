/**
 * Toast accessors; `resetToasts` clears every kernel service holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export {
    installToasts as initialiseToasts,
    resetWebCoreServices as resetToasts,
    toasts,
} from '@sinemacula/web-core/app/services';
