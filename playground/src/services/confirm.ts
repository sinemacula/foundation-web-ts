/**
 * Confirm dialog accessors; `resetConfirm` clears every kernel service holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export {
    confirmDialogs,
    installConfirm as initialiseConfirm,
    resetFoundationWebServices as resetConfirm,
} from '@sinemacula/foundation-web/app/services';
