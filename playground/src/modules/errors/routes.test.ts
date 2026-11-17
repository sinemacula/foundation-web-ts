/**
 * Unit tests for errorsRoutes.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it } from 'vitest';

import { ERRORS_ROUTE_NAMES } from '@/modules/errors/route-names';
import { errorsRoutes } from '@/modules/errors/routes';

describe('errorsRoutes', () => {
    it('contains exactly two routes', () => {
        expect(errorsRoutes).toHaveLength(2);
    });

    it('defines the forbidden route before the catch-all', () => {
        const [forbidden, notFound] = errorsRoutes;

        expect(forbidden?.path).toBe('/forbidden');
        expect(forbidden?.name).toBe(ERRORS_ROUTE_NAMES.forbidden);
        expect(notFound?.path).toBe('/:pathMatch(.*)*');
        expect(notFound?.name).toBe(ERRORS_ROUTE_NAMES.notFound);
    });

    it('sets the meta title translation key for each route', () => {
        const [forbidden, notFound] = errorsRoutes;

        expect(forbidden?.meta?.title).toBe('errors.forbidden.title');
        expect(notFound?.meta?.title).toBe('errors.notFound.title');
    });

    it.each(errorsRoutes)('resolves the lazy component loader for $path', async route => {
        const component = await (route.component as () => Promise<unknown>)();

        expect(component).toBeDefined();
    });
});
