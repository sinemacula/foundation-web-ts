/**
 * Feature-flag accessors; `resetFeatureFlags` clears every kernel holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export {
    featureFlags,
    installFeatureFlags as initialiseFeatureFlags,
    resetFoundationWebServices as resetFeatureFlags,
} from '@sinemacula/foundation-web/app/services';
