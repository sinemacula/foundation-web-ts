/**
 * Analytics accessors; `resetAnalytics` clears every kernel service holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export {
    analytics,
    installAnalytics as initialiseAnalytics,
    resetFoundationWebServices as resetAnalytics,
} from '@sinemacula/foundation-web/app/services';
