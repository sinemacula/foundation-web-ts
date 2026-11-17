/**
 * Analytics accessors; `resetAnalytics` clears every kernel service holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export {
    analytics,
    installAnalytics as initialiseAnalytics,
    resetWebCoreServices as resetAnalytics,
} from '@sinemacula/web-core/app/services';
