/**
 * Unit tests for initial-route-preload.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import type { RouteRecordRaw } from 'vue-router';

import { preloadInitialRoute } from './initial-route-preload';

const Page = defineComponent({ render: () => null });

describe('preloadInitialRoute', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('loads the lazy components of every route the location matches', async () => {
        const parent = vi.fn(async () => Page);
        const child = vi.fn(async () => Page);
        const other = vi.fn(async () => Page);
        const routes: RouteRecordRaw[] = [
            { path: '/users', component: parent, children: [{ path: ':id', component: child }] },
            { path: '/other', component: other },
        ];

        preloadInitialRoute(routes, '/users/7');

        await vi.waitFor(() => {
            expect(child).toHaveBeenCalledOnce();
        });

        expect(parent).toHaveBeenCalledOnce();
        expect(other).not.toHaveBeenCalled();
    });

    it('preloads nothing for a location that only redirects', async () => {
        const target = vi.fn(async () => Page);

        expect(() => {
            preloadInitialRoute(
                [
                    { path: '/', redirect: '/home' },
                    { path: '/home', component: target },
                ],
                '/',
            );
        }).not.toThrow();

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(target).not.toHaveBeenCalled();
    });

    it('swallows a component that fails to load', async () => {
        const unhandled = vi.fn();

        process.on('unhandledRejection', unhandled);

        try {
            preloadInitialRoute([{ path: '/', component: () => Promise.reject(new Error('offline')) }], '/');

            await new Promise(resolve => setTimeout(resolve, 0));

            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    it('keeps loading the other views when one loader throws', async () => {
        const unhandled = vi.fn();
        const side = vi.fn(async () => Page);

        process.on('unhandledRejection', unhandled);

        try {
            preloadInitialRoute(
                [
                    {
                        path: '/',
                        components: {
                            default: () => Promise.reject(new Error('offline')),
                            broken: () => {
                                throw new Error('broken');
                            },
                            side,
                        },
                    },
                ],
                '/',
            );

            await new Promise(resolve => setTimeout(resolve, 0));

            expect(side).toHaveBeenCalledOnce();
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    it.each(['displayName', 'props', '__vccOpts'])('leaves a function component marked by %s alone', marker => {
        const functional = Object.assign(
            vi.fn(() => null),
            { [marker]: marker === 'props' ? [] : 'Page' },
        );

        preloadInitialRoute([{ path: '/', component: functional }], '/');

        expect(functional).not.toHaveBeenCalled();
    });

    it('swallows routes the router cannot be built from', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        expect(() => {
            preloadInitialRoute([{ path: 'no-leading-slash', component: Page }], '/');
        }).not.toThrow();
    });
});
