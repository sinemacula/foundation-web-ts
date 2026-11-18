/**
 * HTTP client accessors; `resetApi` clears every kernel service holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export {
    api,
    installApi as initialiseApi,
    resetFoundationWebServices as resetApi,
} from '@sinemacula/foundation-web/app/services';
