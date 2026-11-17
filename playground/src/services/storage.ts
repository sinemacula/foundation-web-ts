/**
 * Storage accessors; `resetStorage` clears every kernel service holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export {
    appStorage,
    installStorage as initialiseStorage,
    resetWebCoreServices as resetStorage,
} from '@sinemacula/web-core/app/services';
