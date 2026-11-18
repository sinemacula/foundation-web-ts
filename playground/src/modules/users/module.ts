/**
 * Users module definition.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ModuleDefinition } from '@sinemacula/foundation-web/module/module';
import { createLocaleLoader } from '@sinemacula/foundation-web/module/module';

import { usersRoutes } from './routes';

export const usersModule: ModuleDefinition = {
    name: 'users',
    routes: usersRoutes,
    locales: createLocaleLoader({
        'en-US': async () => (await import('./locales/en-us')).default,
        'fr-FR': async () => (await import('./locales/fr-fr')).default,
    }),
};
