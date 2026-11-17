/**
 * Error reporter accessors; `resetReporting` clears every kernel holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export {
    installReporting as initialiseReporting,
    reporting,
    resetWebCoreServices as resetReporting,
} from '@sinemacula/web-core/app/services';
