/**
 * Unit tests for message-catalogue.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it, vi } from 'vitest';

import { I18nError } from '@sinemacula/foundation/i18n/i18n-error';
import type { LocaleMessages, ModuleDefinition } from '../module/module';
import { createApplicationI18n } from './application-i18n';
import type { MessageCatalogueOptions } from './message-catalogue';
import { MessageCatalogue } from './message-catalogue';

/**
 * Build a route-less module with the given messages loader.
 */
function module(name: string, locales?: (locale: string) => Promise<LocaleMessages | null>): ModuleDefinition {
    return { name, routes: [], ...(locales === undefined ? {} : { locales }) };
}

/**
 * Build a catalogue over a fresh i18n instance.
 */
function build(overrides: Partial<MessageCatalogueOptions> = {}) {
    const i18n = createApplicationI18n('en-GB');
    const catalogue = new MessageCatalogue({ i18n, modules: [], ...overrides });

    return { i18n, catalogue };
}

/**
 * Wait for every part load, tolerating failures.
 */
function settle(loads: Promise<void>[]): Promise<unknown> {
    return Promise.allSettled(loads);
}

describe('MessageCatalogue', () => {
    it('installs the shared messages and each module’s under its name', async () => {
        const { i18n, catalogue } = build({
            modules: [
                module('users', async () => ({ title: 'Users' })),
                module('home', async () => ({ title: 'Home' })),
            ],
            sharedLoaders: { 'en-GB': async () => ({ app: 'App' }) },
        });

        await Promise.all(catalogue.load('en-GB', ['users', 'home']));

        expect(i18n.global.getLocaleMessage('en-GB')).toEqual({
            app: 'App',
            users: { title: 'Users' },
            home: { title: 'Home' },
        });
        expect(catalogue.hasLoaded('en-GB', ['users', 'home'])).toBe(true);
    });

    it('loads only the named modules', async () => {
        const other = vi.fn(async () => ({ title: 'Other' }));
        const { i18n, catalogue } = build({
            modules: [module('users', async () => ({ title: 'Users' })), module('other', other)],
        });

        await Promise.all(catalogue.load('en-GB', ['users']));

        expect(other).not.toHaveBeenCalled();
        expect(i18n.global.getLocaleMessage('en-GB')).toMatchObject({ users: { title: 'Users' } });
        expect(catalogue.hasLoaded('en-GB', ['other'])).toBe(false);
    });

    it('starts every part before any has loaded', () => {
        const started: string[] = [];

        /**
         * Build a loader that records its start and never settles.
         */
        const pending = (name: string) => () => {
            started.push(name);

            return new Promise<LocaleMessages>(() => undefined);
        };
        const { catalogue } = build({
            modules: [module('a', pending('a')), module('b', pending('b'))],
            sharedLoaders: { 'en-GB': pending('shared') },
        });

        void Promise.all(catalogue.load('en-GB', ['a', 'b']));

        expect(started).toEqual(['shared', 'a', 'b']);
    });

    it('counts a module with no messages, or none for the locale, as loaded without a namespace', async () => {
        const { i18n, catalogue } = build({ modules: [module('bare'), module('none', async () => null)] });

        await Promise.all(catalogue.load('en-GB', ['bare', 'none', 'unknown']));

        expect(catalogue.hasLoaded('en-GB', ['bare', 'none', 'unknown'])).toBe(true);
        expect(i18n.global.getLocaleMessage('en-GB')).toEqual({});
        expect(catalogue.load('en-GB', ['bare', 'none'])).toEqual([]);
    });

    it('loads each part once per locale, sharing a load in flight', async () => {
        const loader = vi.fn(async (locale: string) => ({ title: locale }));
        const { i18n, catalogue } = build({ modules: [module('users', loader)] });

        const first = catalogue.load('en-GB', ['users']);
        const second = catalogue.load('en-GB', ['users']);

        expect(second).toHaveLength(2);
        expect(second[0]).toBe(first[0]);
        expect(second[1]).toBe(first[1]);

        await Promise.all([...first, ...catalogue.load('fr-FR', ['users'])]);

        expect(catalogue.load('en-GB', ['users'])).toEqual([]);
        expect(loader.mock.calls).toEqual([['en-GB'], ['fr-FR']]);
        expect(i18n.global.getLocaleMessage('fr-FR')).toEqual({ users: { title: 'fr-FR' } });
    });

    it('retries a part whose load failed and keeps the parts that loaded', async () => {
        let attempts = 0;
        const { i18n, catalogue } = build({
            modules: [
                module('users', async () => ({ title: 'Users' })),
                module('flaky', () => {
                    attempts += 1;

                    return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ title: 'Flaky' });
                }),
            ],
        });

        await expect(Promise.all(catalogue.load('en-GB', ['users', 'flaky']))).rejects.toThrow('offline');
        await settle(catalogue.load('en-GB', []));

        expect(catalogue.hasLoaded('en-GB', ['users'])).toBe(true);
        expect(catalogue.hasLoaded('en-GB', ['flaky'])).toBe(false);

        await Promise.all(catalogue.load('en-GB', ['users', 'flaky']));

        expect(i18n.global.getLocaleMessage('en-GB')).toEqual({ users: { title: 'Users' }, flaky: { title: 'Flaky' } });
    });

    it('lets a module replace a shared key of the same name wholesale by default', async () => {
        const { i18n, catalogue } = build({
            modules: [module('common', async () => ({ greeting: 'Module' }))],
            sharedLoaders: { 'en-GB': async () => ({ common: { greeting: 'Shared', farewell: 'Bye' } }) },
        });

        await Promise.all(catalogue.load('en-GB', ['common']));

        expect(i18n.global.getLocaleMessage('en-GB')).toEqual({ common: { greeting: 'Module' } });
    });

    it.each([
        ['the shared messages load first', 0, 1],
        ['the module loads first', 1, 0],
    ])('rejects a collision when %s, without installing the colliding part', async (_, sharedDelay, moduleDelay) => {
        /**
         * Resolve after the given number of timer turns.
         */
        const resolveAfter = <T>(turns: number, value: T) =>
            new Promise<T>(resolve => {
                setTimeout(() => resolve(value), turns);
            });
        const { i18n, catalogue } = build({
            modules: [
                module('common', () => resolveAfter(moduleDelay, { greeting: 'Module' })),
                module('users', async () => ({ title: 'Users' })),
            ],
            sharedLoaders: { 'en-GB': () => resolveAfter(sharedDelay, { common: 'Shared' }) },
            onNamespaceCollision: 'error',
        });

        await expect(Promise.all(catalogue.load('en-GB', ['common', 'users']))).rejects.toThrow(
            new I18nError('Module "common" collides with a shared top-level translation key for locale "en-GB".'),
        );
        await settle(catalogue.load('en-GB', []));

        expect(catalogue.hasLoaded('en-GB', ['common'])).toBe(false);
        expect(i18n.global.getLocaleMessage('en-GB')).toMatchObject({ users: { title: 'Users' } });
    });

    it('treats a locale already on the instance as complete and never recomposes it', () => {
        const i18n = createApplicationI18n('en-GB');
        const loader = vi.fn(async () => ({ title: 'Users' }));

        i18n.global.setLocaleMessage('en-GB', { preset: 'kept' });

        const catalogue = new MessageCatalogue({ i18n, modules: [module('users', loader)] });

        expect(catalogue.load('en-GB', ['users'])).toEqual([]);
        expect(catalogue.hasLoaded('en-GB', ['users'])).toBe(true);
        expect(loader).not.toHaveBeenCalled();
        expect(i18n.global.getLocaleMessage('en-GB')).toEqual({ preset: 'kept' });
    });

    it('loads every module at once through a custom message source', async () => {
        const messages = vi.fn(async (locale: string) => ({ users: { title: locale }, home: { title: 'Home' } }));
        const { i18n, catalogue } = build({ messageSource: { messages } });

        await Promise.all(catalogue.load('en-GB', ['users']));

        expect(messages).toHaveBeenCalledOnce();
        expect(catalogue.hasLoaded('en-GB', ['anything'])).toBe(true);
        expect(i18n.global.getLocaleMessage('en-GB')).toEqual({ users: { title: 'en-GB' }, home: { title: 'Home' } });
    });
});
