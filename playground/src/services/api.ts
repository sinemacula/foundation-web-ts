/**
 * HTTP client accessors; `resetApi` clears every kernel service holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export { api, installApi as initialiseApi, resetWebCoreServices as resetApi } from '@sinemacula/web-core/app/services';
