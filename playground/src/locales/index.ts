/**
 * Shared translation loaders; each locale is a lazily imported chunk.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { LocaleMessages } from '@sinemacula/foundation-web/module/module';

export const sharedLocaleLoaders: Readonly<Record<string, () => Promise<LocaleMessages>>> = {
    'en-US': async () => (await import('./en-us')).default,
    'fr-FR': async () => (await import('./fr-fr')).default,
};
