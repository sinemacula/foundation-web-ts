/**
 * Logger accessors; `resetLogger` clears every kernel service holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export {
    installLogger as initialiseLogger,
    logger,
    resetWebCoreServices as resetLogger,
} from '@sinemacula/web-core/app/services';
