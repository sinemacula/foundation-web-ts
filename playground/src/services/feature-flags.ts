/**
 * Feature-flag accessors; `resetFeatureFlags` clears every kernel holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export {
    featureFlags,
    installFeatureFlags as initialiseFeatureFlags,
    resetWebCoreServices as resetFeatureFlags,
} from '@sinemacula/web-core/app/services';
