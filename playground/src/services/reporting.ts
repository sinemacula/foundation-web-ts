/**
 * Error reporter accessors; `resetReporting` clears every kernel holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export {
    installReporting as initialiseReporting,
    reporting,
    resetFoundationWebServices as resetReporting,
} from '@sinemacula/foundation-web/app/services';
