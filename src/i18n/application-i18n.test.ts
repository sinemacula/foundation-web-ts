/**
 * Unit tests for application-i18n.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModuleDefinition } from '../module/module';
import type { ModuleMessageSource } from '../module/module-registry';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import type { LocaleSwitcherOptions } from './application-i18n';
import { activateLocale, createApplicationI18n, createLocaleSwitcher } from './application-i18n';
import { I18nError } from '@sinemacula/foundation/i18n/i18n-error';
import { LocaleService } from '@sinemacula/foundation/i18n/locale-service';

describe('createApplicationI18n', () => {
    it('creates a composition-mode instance', () => {
        const i18n = createApplicationI18n('en-GB');

        expect(i18n.mode).toBe('composition');
    });

    it('sets the initial locale to the provided defaultLocale', () => {
        const i18n = createApplicationI18n('fr-FR');

        expect(i18n.global.locale.value).toBe('fr-FR');
    });

    it('sets the fallback locale to the provided defaultLocale', () => {
        const i18n = createApplicationI18n('en-GB');

        expect(i18n.global.fallbackLocale.value).toBe('en-GB');
    });

    it('installs datetime formats when provided', () => {
        const i18n = createApplicationI18n('en-GB', {
            datetime: { 'en-GB': { short: { year: 'numeric', month: '2-digit', day: '2-digit' } } },
        });

        expect(i18n.global.getDateTimeFormat('en-GB')).toEqual({
            short: { year: 'numeric', month: '2-digit', day: '2-digit' },
        });
    });

    it('installs number formats when provided', () => {
        const i18n = createApplicationI18n('en-GB', {
            number: { 'en-GB': { decimal: { style: 'decimal' } } },
        });

        expect(i18n.global.getNumberFormat('en-GB')).toEqual({ decimal: { style: 'decimal' } });
    });

    it('installs no datetime/number formats when formats is omitted', () => {
        const i18n = createApplicationI18n('en-GB');

        expect(i18n.global.getDateTimeFormat('en-GB')).toEqual({});
        expect(i18n.global.getNumberFormat('en-GB')).toEqual({});
    });
});

describe('activateLocale', () => {
    afterEach(() => {
        document.documentElement.removeAttribute('lang');
        document.documentElement.removeAttribute('dir');
    });

    it('loads shared messages and merges them onto the locale', async () => {
        const i18n = createApplicationI18n('en-GB');

        await activateLocale({
            i18n,
            modules: [],
            sharedLoaders: {
                'en-GB': async () => ({ welcome: 'Hello' }),
            },
            locale: 'en-GB',
            direction: 'ltr',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        expect(i18n.global.t('welcome')).toBe('Hello');
    });

    it('namespaces module messages under the module name', async () => {
        const i18n = createApplicationI18n('en-GB');
        const localisedModule: ModuleDefinition = {
            name: 'auth',
            routes: [],
            locales: async () => ({ login: 'Sign in' }),
        };

        await activateLocale({
            i18n,
            modules: [localisedModule],
            locale: 'en-GB',
            direction: 'ltr',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        const messages = i18n.global.getLocaleMessage('en-GB');

        expect((messages as Record<string, Record<string, string>>)['auth']?.['login']).toBe('Sign in');
    });

    it('switches the locale ref to the activated locale', async () => {
        const i18n = createApplicationI18n('en-GB');

        await activateLocale({
            i18n,
            modules: [],
            locale: 'fr-FR',
            direction: 'ltr',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        expect(i18n.global.locale.value).toBe('fr-FR');
    });

    it('sets lang and dir attributes on the provided targetDocument', async () => {
        const i18n = createApplicationI18n('en-GB');
        const target = document.implementation.createHTMLDocument('t');

        await activateLocale({
            i18n,
            modules: [],
            locale: 'ar-SA',
            direction: 'rtl',
            targetDocument: target,
        });

        expect(target.documentElement.getAttribute('lang')).toBe('ar-SA');
        expect(target.documentElement.getAttribute('dir')).toBe('rtl');
    });

    it('sets lang and dir attributes on the global document when targetDocument is omitted', async () => {
        const i18n = createApplicationI18n('en-GB');

        await activateLocale({
            i18n,
            modules: [],
            locale: 'en-GB',
            direction: 'ltr',
        });

        expect(document.documentElement.getAttribute('lang')).toBe('en-GB');
        expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    });

    it('handles a locale absent from sharedLoaders without throwing', async () => {
        const i18n = createApplicationI18n('en-GB');

        await activateLocale({
            i18n,
            modules: [],
            sharedLoaders: {
                'fr-FR': async () => ({ bonjour: 'Bonjour' }),
            },
            locale: 'en-GB',
            direction: 'ltr',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        expect(i18n.global.locale.value).toBe('en-GB');
    });

    it('activates without sharedLoaders', async () => {
        const i18n = createApplicationI18n('en-GB');

        await activateLocale({
            i18n,
            modules: [],
            locale: 'en-GB',
            direction: 'ltr',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        expect(i18n.global.locale.value).toBe('en-GB');
    });

    it('does not load fallback messages when fallbackLocale equals the active locale', async () => {
        const i18n = createApplicationI18n('en-GB');
        let loaderCalls = 0;

        const sharedLoaders = {
            'en-GB': () => {
                loaderCalls += 1;

                return Promise.resolve({ hello: 'Hello' });
            },
        };

        await activateLocale({
            i18n,
            modules: [],
            sharedLoaders,
            locale: 'en-GB',
            direction: 'ltr',
            fallbackLocale: 'en-GB',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        expect(loaderCalls).toBe(1);
        expect(i18n.global.locale.value).toBe('en-GB');
    });

    it('loads fallback messages when fallbackLocale differs from the active locale', async () => {
        const i18n = createApplicationI18n('en-GB');
        const localisedModule: ModuleDefinition = {
            name: 'auth',
            routes: [],
            locales: async (locale: string) =>
                locale === 'en-GB' ? { login: 'Sign in' } : { login: 'Iniciar sesión' },
        };

        await activateLocale({
            i18n,
            modules: [localisedModule],
            sharedLoaders: {
                'en-GB': async () => ({ welcome: 'Welcome' }),
                'es-ES': async () => ({ welcome: 'Bienvenido' }),
            },
            locale: 'es-ES',
            direction: 'ltr',
            fallbackLocale: 'en-GB',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        expect(i18n.global.locale.value).toBe('es-ES');

        const fallbackMessages = i18n.global.getLocaleMessage('en-GB') as Record<string, unknown>;

        expect(fallbackMessages['welcome']).toBe('Welcome');
        expect((fallbackMessages['auth'] as Record<string, string>)['login']).toBe('Sign in');
    });

    it('does not load fallback messages when fallbackLocale is undefined', async () => {
        const i18n = createApplicationI18n('en-GB');

        await activateLocale({
            i18n,
            modules: [],
            sharedLoaders: {
                'en-GB': async () => ({ hello: 'Hello' }),
            },
            locale: 'fr-FR',
            direction: 'ltr',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        const enMessages = i18n.global.getLocaleMessage('en-GB') as Record<string, unknown>;

        expect(enMessages['hello']).toBeUndefined();
        expect(i18n.global.locale.value).toBe('fr-FR');
    });

    it('loads fallback messages using module messages when sharedLoaders is omitted', async () => {
        const i18n = createApplicationI18n('en-GB');
        const localisedModule: ModuleDefinition = {
            name: 'auth',
            routes: [],
            locales: async (locale: string) => (locale === 'en-GB' ? { login: 'Sign in' } : { login: 'Se connecter' }),
        };

        await activateLocale({
            i18n,
            modules: [localisedModule],
            locale: 'fr-FR',
            direction: 'ltr',
            fallbackLocale: 'en-GB',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        expect(i18n.global.locale.value).toBe('fr-FR');

        const fallbackMessages = i18n.global.getLocaleMessage('en-GB') as Record<string, unknown>;

        expect((fallbackMessages['auth'] as Record<string, string>)['login']).toBe('Sign in');
    });

    it('uses the message source instead of module loaders for the active locale', async () => {
        const i18n = createApplicationI18n('en-GB');
        let loaderCalls = 0;
        const localisedModule: ModuleDefinition = {
            name: 'auth',
            routes: [],
            locales: () => {
                loaderCalls += 1;

                return Promise.resolve({ login: 'Sign in' });
            },
        };
        const requested: string[] = [];
        const source: ModuleMessageSource = {
            messages: locale => {
                requested.push(locale);

                return Promise.resolve({ auth: { login: 'From source' } });
            },
        };

        await activateLocale({
            i18n,
            modules: [localisedModule],
            locale: 'en-GB',
            direction: 'ltr',
            messageSource: source,
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        expect(loaderCalls).toBe(0);
        expect(requested).toEqual(['en-GB']);

        const messages = i18n.global.getLocaleMessage('en-GB') as Record<string, Record<string, string>>;

        expect(messages['auth']?.['login']).toBe('From source');
    });

    it('uses the message source for the fallback locale load as well', async () => {
        const i18n = createApplicationI18n('en-GB');
        const requested: string[] = [];
        const source: ModuleMessageSource = {
            messages: locale => {
                requested.push(locale);

                return Promise.resolve({ auth: { login: locale === 'en-GB' ? 'Sign in' : 'Iniciar sesión' } });
            },
        };

        await activateLocale({
            i18n,
            modules: [],
            locale: 'es-ES',
            direction: 'ltr',
            fallbackLocale: 'en-GB',
            messageSource: source,
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        expect(requested).toEqual(['es-ES', 'en-GB']);

        const active = i18n.global.getLocaleMessage('es-ES') as Record<string, Record<string, string>>;
        const fallback = i18n.global.getLocaleMessage('en-GB') as Record<string, Record<string, string>>;

        expect(active['auth']?.['login']).toBe('Iniciar sesión');
        expect(fallback['auth']?.['login']).toBe('Sign in');
    });

    it('requests the message source once when fallbackLocale equals the active locale', async () => {
        const i18n = createApplicationI18n('en-GB');
        const requested: string[] = [];
        const source: ModuleMessageSource = {
            messages: locale => {
                requested.push(locale);

                return Promise.resolve({});
            },
        };

        await activateLocale({
            i18n,
            modules: [],
            locale: 'en-GB',
            direction: 'ltr',
            fallbackLocale: 'en-GB',
            messageSource: source,
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        expect(requested).toEqual(['en-GB']);
    });

    it('lets a module shadow a shared top-level key when the collision option is absent', async () => {
        const i18n = createApplicationI18n('en-GB');
        const collidingModule: ModuleDefinition = {
            name: 'common',
            routes: [],
            locales: async () => ({ greeting: 'From module' }),
        };

        await activateLocale({
            i18n,
            modules: [collidingModule],
            sharedLoaders: {
                'en-GB': async () => ({ common: { greeting: 'From shared' }, welcome: 'Hello' }),
            },
            locale: 'en-GB',
            direction: 'ltr',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        const messages = i18n.global.getLocaleMessage('en-GB') as Record<string, Record<string, string>>;

        expect(messages['common']?.['greeting']).toBe('From module');
        expect(i18n.global.t('welcome')).toBe('Hello');
    });

    it('lets a module shadow a shared top-level key when module-wins is explicit', async () => {
        const i18n = createApplicationI18n('en-GB');
        const collidingModule: ModuleDefinition = {
            name: 'common',
            routes: [],
            locales: async () => ({ greeting: 'From module' }),
        };

        await activateLocale({
            i18n,
            modules: [collidingModule],
            sharedLoaders: {
                'en-GB': async () => ({ common: { greeting: 'From shared' }, welcome: 'Hello' }),
            },
            locale: 'en-GB',
            direction: 'ltr',
            onNamespaceCollision: 'module-wins',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        const messages = i18n.global.getLocaleMessage('en-GB') as Record<string, Record<string, string>>;

        expect(messages['common']?.['greeting']).toBe('From module');
        expect(i18n.global.t('welcome')).toBe('Hello');
    });

    it('throws naming the colliding module and the locale', async () => {
        const i18n = createApplicationI18n('en-GB');
        const collidingModule: ModuleDefinition = {
            name: 'common',
            routes: [],
            locales: async () => ({ greeting: 'From module' }),
        };

        await expect(
            activateLocale({
                i18n,
                modules: [collidingModule],
                sharedLoaders: {
                    'fr-FR': async () => ({ common: { greeting: 'From shared' } }),
                },
                locale: 'fr-FR',
                direction: 'ltr',
                onNamespaceCollision: 'error',
                targetDocument: document.implementation.createHTMLDocument('t'),
            }),
        ).rejects.toThrow('Module "common" collides with a shared top-level translation key for locale "fr-FR".');

        expect(i18n.global.locale.value).toBe('en-GB');
    });

    it('reports only a module that actually collides', async () => {
        const i18n = createApplicationI18n('en-GB');
        const cleanModule: ModuleDefinition = {
            name: 'auth',
            routes: [],
            locales: async () => ({ login: 'Sign in' }),
        };
        const collidingModule: ModuleDefinition = {
            name: 'common',
            routes: [],
            locales: async () => ({ greeting: 'From module' }),
        };

        await expect(
            activateLocale({
                i18n,
                modules: [cleanModule, collidingModule],
                sharedLoaders: {
                    'en-GB': async () => ({ common: { greeting: 'From shared' } }),
                },
                locale: 'en-GB',
                direction: 'ltr',
                onNamespaceCollision: 'error',
                targetDocument: document.implementation.createHTMLDocument('t'),
            }),
        ).rejects.toThrow('Module "common" collides with a shared top-level translation key for locale "en-GB".');
    });

    it('reports a fallback-locale collision without failing the activation', async () => {
        const i18n = createApplicationI18n('en-GB');
        const onFallbackError = vi.fn();
        const collidingModule: ModuleDefinition = {
            name: 'common',
            routes: [],
            locales: async () => ({ greeting: 'From module' }),
        };

        await activateLocale({
            i18n,
            modules: [collidingModule],
            sharedLoaders: {
                'es-ES': async () => ({ welcome: 'Hola' }),
                'en-GB': async () => ({ common: { greeting: 'From shared' } }),
            },
            locale: 'es-ES',
            direction: 'ltr',
            fallbackLocale: 'en-GB',
            onNamespaceCollision: 'error',
            onFallbackError,
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        await vi.waitFor(() => {
            expect(onFallbackError).toHaveBeenCalledOnce();
        });

        expect(i18n.global.locale.value).toBe('es-ES');
        expect(onFallbackError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Module "common" collides with a shared top-level translation key for locale "en-GB".',
            }),
            'en-GB',
        );
    });

    it('activates a locale whose fallback fails to load and reports the fallback', async () => {
        const i18n = createApplicationI18n('en-GB');
        const failure = new Error('offline');
        const onFallbackError = vi.fn();
        const target = document.implementation.createHTMLDocument('t');

        await activateLocale({
            i18n,
            modules: [],
            sharedLoaders: { 'es-ES': async () => ({ welcome: 'Hola' }), 'en-GB': () => Promise.reject(failure) },
            locale: 'es-ES',
            direction: 'ltr',
            fallbackLocale: 'en-GB',
            onFallbackError,
            targetDocument: target,
        });

        await vi.waitFor(() => {
            expect(onFallbackError).toHaveBeenCalledWith(failure, 'en-GB');
        });

        expect(i18n.global.t('welcome')).toBe('Hola');
        expect(target.documentElement.getAttribute('lang')).toBe('es-ES');
    });

    it('activates without waiting for a fallback that has not loaded', async () => {
        const i18n = createApplicationI18n('en-GB');

        await activateLocale({
            i18n,
            modules: [],
            sharedLoaders: {
                'es-ES': async () => ({ welcome: 'Hola' }),
                'en-GB': () => new Promise<Record<string, string>>(() => undefined),
            },
            locale: 'es-ES',
            direction: 'ltr',
            fallbackLocale: 'en-GB',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        expect(i18n.global.locale.value).toBe('es-ES');
    });

    it('contains a fallback handler that throws', async () => {
        const i18n = createApplicationI18n('en-GB');
        const unhandled = vi.fn();
        const onFallbackError = vi.fn(() => {
            throw new Error('reporter down');
        });

        process.on('unhandledRejection', unhandled);

        try {
            await activateLocale({
                i18n,
                modules: [],
                sharedLoaders: {
                    'es-ES': async () => ({ welcome: 'Hola' }),
                    'en-GB': () => Promise.reject(new Error('offline')),
                },
                locale: 'es-ES',
                direction: 'ltr',
                fallbackLocale: 'en-GB',
                onFallbackError,
                targetDocument: document.implementation.createHTMLDocument('t'),
            });

            await vi.waitFor(() => {
                expect(onFallbackError).toHaveBeenCalledOnce();
            });
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    it('activates when the fallback fails and no handler is given', async () => {
        const i18n = createApplicationI18n('en-GB');

        await activateLocale({
            i18n,
            modules: [],
            sharedLoaders: {
                'es-ES': async () => ({ welcome: 'Hola' }),
                'en-GB': () => Promise.reject(new Error('offline')),
            },
            locale: 'es-ES',
            direction: 'ltr',
            fallbackLocale: 'en-GB',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        expect(i18n.global.locale.value).toBe('es-ES');
    });

    it('rejects when its own messages fail even though the fallback loads', async () => {
        const i18n = createApplicationI18n('en-GB');

        await expect(
            activateLocale({
                i18n,
                modules: [],
                sharedLoaders: {
                    'es-ES': () => Promise.reject(new Error('offline')),
                    'en-GB': async () => ({ welcome: 'Hello' }),
                },
                locale: 'es-ES',
                direction: 'ltr',
                fallbackLocale: 'en-GB',
                targetDocument: document.implementation.createHTMLDocument('t'),
            }),
        ).rejects.toThrow('offline');

        expect(i18n.global.locale.value).toBe('en-GB');
    });

    it('applies collision detection to message-source results', async () => {
        const i18n = createApplicationI18n('en-GB');
        const source: ModuleMessageSource = {
            messages: async () => ({ common: { greeting: 'From source' } }),
        };

        await expect(
            activateLocale({
                i18n,
                modules: [],
                sharedLoaders: {
                    'en-GB': async () => ({ common: { greeting: 'From shared' } }),
                },
                locale: 'en-GB',
                direction: 'ltr',
                messageSource: source,
                onNamespaceCollision: 'error',
                targetDocument: document.implementation.createHTMLDocument('t'),
            }),
        ).rejects.toThrow('Module "common" collides with a shared top-level translation key for locale "en-GB".');
    });

    it('activates normally when error mode finds no collision', async () => {
        const i18n = createApplicationI18n('en-GB');
        const localisedModule: ModuleDefinition = {
            name: 'auth',
            routes: [],
            locales: async () => ({ login: 'Sign in' }),
        };

        await activateLocale({
            i18n,
            modules: [localisedModule],
            sharedLoaders: {
                'en-GB': async () => ({ welcome: 'Hello' }),
            },
            locale: 'en-GB',
            direction: 'ltr',
            onNamespaceCollision: 'error',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        const messages = i18n.global.getLocaleMessage('en-GB') as Record<string, Record<string, string>>;

        expect(messages['auth']?.['login']).toBe('Sign in');
        expect(i18n.global.t('welcome')).toBe('Hello');
        expect(i18n.global.locale.value).toBe('en-GB');
    });
});

describe('createLocaleSwitcher', () => {
    afterEach(() => {
        document.documentElement.removeAttribute('lang');
        document.documentElement.removeAttribute('dir');
    });

    /** Build a locale service enabling en-GB and fr-FR over memory storage. */
    function buildLocaleService(): LocaleService {
        return new LocaleService({
            defaultLocale: 'en-GB',
            enabledLocales: ['en-GB', 'fr-FR'],
            storage: new MemoryStorage(),
        });
    }

    it('mirrors the i18n instance locale reactively', async () => {
        const i18n = createApplicationI18n('en-GB');
        const switcher = createLocaleSwitcher({
            i18n,
            modules: [],
            localeService: buildLocaleService(),
            supported: { 'en-GB': { direction: 'ltr' }, 'fr-FR': { direction: 'ltr' } },
            fallbackLocale: 'en-GB',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        expect(switcher.current.value).toBe('en-GB');

        await switcher.switchTo('fr-FR');

        expect(switcher.current.value).toBe('fr-FR');
    });

    it('persists the matched locale and activates it with the matched direction', async () => {
        const i18n = createApplicationI18n('en-GB');
        const storage = new MemoryStorage();
        const localeService = new LocaleService({
            defaultLocale: 'en-GB',
            enabledLocales: ['en-GB', 'ar-SA'],
            storage,
        });
        const target = document.implementation.createHTMLDocument('t');

        const switcher = createLocaleSwitcher({
            i18n,
            modules: [],
            localeService,
            supported: { 'en-GB': { direction: 'ltr' }, 'ar-SA': { direction: 'rtl' } },
            fallbackLocale: 'en-GB',
            targetDocument: target,
        });

        await switcher.switchTo('ar-SA');

        expect(storage.get('locale')).toBe('ar-SA');
        expect(target.documentElement.getAttribute('dir')).toBe('rtl');
    });

    it('matches a regional candidate to its enabled locale before activating', async () => {
        const i18n = createApplicationI18n('en-GB');
        const switcher = createLocaleSwitcher({
            i18n,
            modules: [],
            localeService: buildLocaleService(),
            supported: { 'en-GB': { direction: 'ltr' }, 'fr-FR': { direction: 'ltr' } },
            fallbackLocale: 'en-GB',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        await switcher.switchTo('fr-CA');

        expect(switcher.current.value).toBe('fr-FR');
    });

    it('falls back to ltr when the matched locale is absent from the supported map', async () => {
        const i18n = createApplicationI18n('en-GB');
        const target = document.implementation.createHTMLDocument('t');

        const switcher = createLocaleSwitcher({
            i18n,
            modules: [],
            localeService: buildLocaleService(),
            supported: { 'en-GB': { direction: 'ltr' } },
            fallbackLocale: 'en-GB',
            targetDocument: target,
        });

        await switcher.switchTo('fr-FR');

        expect(target.documentElement.getAttribute('dir')).toBe('ltr');
    });

    it('throws naming a locale that matches no enabled locale', async () => {
        const i18n = createApplicationI18n('en-GB');
        const switcher = createLocaleSwitcher({
            i18n,
            modules: [],
            localeService: buildLocaleService(),
            supported: { 'en-GB': { direction: 'ltr' }, 'fr-FR': { direction: 'ltr' } },
            fallbackLocale: 'en-GB',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        await expect(switcher.switchTo('de-DE')).rejects.toThrow('de-DE');
    });

    it('forwards sharedLoaders through to activation', async () => {
        const i18n = createApplicationI18n('en-GB');
        const switcher = createLocaleSwitcher({
            i18n,
            modules: [],
            sharedLoaders: {
                'fr-FR': async () => ({ welcome: 'Bienvenue' }),
            },
            localeService: buildLocaleService(),
            supported: { 'en-GB': { direction: 'ltr' }, 'fr-FR': { direction: 'ltr' } },
            fallbackLocale: 'en-GB',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        await switcher.switchTo('fr-FR');

        expect(i18n.global.t('welcome')).toBe('Bienvenue');
    });

    it('sets lang/dir on the global document when targetDocument is omitted', async () => {
        const i18n = createApplicationI18n('en-GB');
        const switcher = createLocaleSwitcher({
            i18n,
            modules: [],
            localeService: buildLocaleService(),
            supported: { 'en-GB': { direction: 'ltr' }, 'fr-FR': { direction: 'ltr' } },
            fallbackLocale: 'en-GB',
        });

        await switcher.switchTo('fr-FR');

        expect(document.documentElement.getAttribute('lang')).toBe('fr-FR');
    });

    it('forwards the message source through to activation', async () => {
        const i18n = createApplicationI18n('en-GB');
        const requested: string[] = [];
        const source: ModuleMessageSource = {
            messages: locale => {
                requested.push(locale);

                return Promise.resolve({ auth: { login: locale } });
            },
        };

        const switcher = createLocaleSwitcher({
            i18n,
            modules: [],
            localeService: buildLocaleService(),
            supported: { 'en-GB': { direction: 'ltr' }, 'fr-FR': { direction: 'ltr' } },
            fallbackLocale: 'en-GB',
            messageSource: source,
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        await switcher.switchTo('fr-FR');

        expect(requested).toEqual(['fr-FR', 'en-GB']);

        const messages = i18n.global.getLocaleMessage('fr-FR') as Record<string, Record<string, string>>;

        expect(messages['auth']?.['login']).toBe('fr-FR');
    });

    it('forwards the collision strategy through to activation', async () => {
        const i18n = createApplicationI18n('en-GB');
        const collidingModule: ModuleDefinition = {
            name: 'common',
            routes: [],
            locales: async () => ({ greeting: 'From module' }),
        };

        const switcher = createLocaleSwitcher({
            i18n,
            modules: [collidingModule],
            sharedLoaders: {
                'fr-FR': async () => ({ common: { greeting: 'From shared' } }),
            },
            localeService: buildLocaleService(),
            supported: { 'en-GB': { direction: 'ltr' }, 'fr-FR': { direction: 'ltr' } },
            fallbackLocale: 'en-GB',
            onNamespaceCollision: 'error',
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        await expect(switcher.switchTo('fr-FR')).rejects.toThrow(
            'Module "common" collides with a shared top-level translation key for locale "fr-FR".',
        );
    });

    describe('switch ordering and failure', () => {
        /**
         * A shared loader whose result the test settles on demand.
         */
        interface DeferredLoader {
            /** The loader the switcher calls. */
            readonly load: () => Promise<Record<string, string>>;

            /** Resolve the pending load with `messages`. */
            readonly resolve: (messages: Record<string, string>) => void;

            /** Reject the pending load with `error`. */
            readonly reject: (error: Error) => void;
        }

        /** Build a shared loader whose result the test settles on demand. */
        function deferredLoader(): DeferredLoader {
            let resolve!: (messages: Record<string, string>) => void;
            let reject!: (error: Error) => void;
            const promise = new Promise<Record<string, string>>((res, rej) => {
                resolve = res;
                reject = rej;
            });

            return { load: () => promise, resolve, reject };
        }

        /** Build a switcher over three enabled locales with `en-GB` stored. */
        function buildSwitcher(
            sharedLoaders: Record<string, () => Promise<Record<string, string>>>,
            overrides: Partial<LocaleSwitcherOptions> = {},
        ) {
            const i18n = createApplicationI18n('en-GB');
            const storage = new MemoryStorage();
            const target = document.implementation.createHTMLDocument('t');

            storage.set('locale', 'en-GB');

            const switcher = createLocaleSwitcher({
                i18n,
                modules: [],
                sharedLoaders,
                localeService: new LocaleService({
                    defaultLocale: 'en-GB',
                    enabledLocales: ['en-GB', 'fr-FR', 'ar-SA'],
                    storage,
                }),
                supported: {
                    'en-GB': { direction: 'ltr' },
                    'fr-FR': { direction: 'ltr' },
                    'ar-SA': { direction: 'rtl' },
                },
                fallbackLocale: 'en-GB',
                targetDocument: target,
                ...overrides,
            });

            return { i18n, storage, target, switcher };
        }

        it('leaves the stored and active locale unchanged when the load fails', async () => {
            const { storage, target, switcher } = buildSwitcher({
                'fr-FR': () => Promise.reject(new Error('chunk failed')),
            });

            await expect(switcher.switchTo('fr-FR')).rejects.toThrow('chunk failed');

            expect(storage.get('locale')).toBe('en-GB');
            expect(switcher.current.value).toBe('en-GB');
            expect(target.documentElement.hasAttribute('lang')).toBe(false);
        });

        it('leaves the stored locale unchanged when a namespace collision rejects the switch', async () => {
            const i18n = createApplicationI18n('en-GB');
            const storage = new MemoryStorage();

            storage.set('locale', 'en-GB');

            const switcher = createLocaleSwitcher({
                i18n,
                modules: [{ name: 'common', routes: [], locales: async () => ({ greeting: 'From module' }) }],
                sharedLoaders: { 'fr-FR': async () => ({ common: 'From shared' }) },
                localeService: new LocaleService({
                    defaultLocale: 'en-GB',
                    enabledLocales: ['en-GB', 'fr-FR'],
                    storage,
                }),
                supported: { 'en-GB': { direction: 'ltr' }, 'fr-FR': { direction: 'ltr' } },
                fallbackLocale: 'en-GB',
                onNamespaceCollision: 'error',
                targetDocument: document.implementation.createHTMLDocument('t'),
            });

            await expect(switcher.switchTo('fr-FR')).rejects.toThrow('collides');

            expect(storage.get('locale')).toBe('en-GB');
            expect(switcher.current.value).toBe('en-GB');
        });

        it('retries a locale whose earlier load failed', async () => {
            let attempts = 0;
            const { storage, switcher } = buildSwitcher({
                'fr-FR': () => {
                    attempts += 1;

                    return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ hi: 'Salut' });
                },
            });

            await expect(switcher.switchTo('fr-FR')).rejects.toThrow('offline');
            await switcher.switchTo('fr-FR');

            expect(switcher.current.value).toBe('fr-FR');
            expect(storage.get('locale')).toBe('fr-FR');
        });

        it('lets the latest selection win when an earlier switch loads last', async () => {
            const french = deferredLoader();
            const arabic = deferredLoader();
            const { i18n, storage, target, switcher } = buildSwitcher({ 'fr-FR': french.load, 'ar-SA': arabic.load });

            const first = switcher.switchTo('fr-FR');
            const second = switcher.switchTo('ar-SA');

            arabic.resolve({ hi: 'Marhaba' });
            await second;
            french.resolve({ hi: 'Salut' });
            await first;

            expect(switcher.current.value).toBe('ar-SA');
            expect(i18n.global.t('hi')).toBe('Marhaba');
            expect(target.documentElement.getAttribute('lang')).toBe('ar-SA');
            expect(target.documentElement.getAttribute('dir')).toBe('rtl');
            expect(storage.get('locale')).toBe('ar-SA');
        });

        it('applies nothing for a superseded switch that loads first', async () => {
            const french = deferredLoader();
            const arabic = deferredLoader();
            const { storage, target, switcher } = buildSwitcher({ 'fr-FR': french.load, 'ar-SA': arabic.load });

            const first = switcher.switchTo('fr-FR');
            const second = switcher.switchTo('ar-SA');

            french.resolve({ hi: 'Salut' });
            await first;

            expect(switcher.current.value).toBe('en-GB');
            expect(target.documentElement.hasAttribute('lang')).toBe(false);
            expect(storage.get('locale')).toBe('en-GB');

            arabic.resolve({ hi: 'Marhaba' });
            await second;

            expect(switcher.current.value).toBe('ar-SA');
        });

        it('still rejects a superseded switch whose own load fails', async () => {
            const french = deferredLoader();
            const { storage, switcher } = buildSwitcher({
                'fr-FR': french.load,
                'ar-SA': async () => ({ hi: 'Marhaba' }),
            });

            const first = switcher.switchTo('fr-FR');

            await switcher.switchTo('ar-SA');
            french.reject(new Error('chunk failed'));

            await expect(first).rejects.toThrow('chunk failed');
            expect(switcher.current.value).toBe('ar-SA');
            expect(storage.get('locale')).toBe('ar-SA');
        });

        it('loads each locale once across repeated switches', async () => {
            const calls: string[] = [];
            const i18n = createApplicationI18n('en-GB');
            const source: ModuleMessageSource = {
                messages: locale => {
                    calls.push(`module:${locale}`);

                    return Promise.resolve({});
                },
            };

            /**
             * Build a shared loader recording each call.
             */
            const recording = (locale: string) => () => {
                calls.push(`shared:${locale}`);

                return Promise.resolve({});
            };
            const shared = {
                i18n,
                modules: [],
                sharedLoaders: { 'en-GB': recording('en-GB'), 'fr-FR': recording('fr-FR') },
                messageSource: source,
                fallbackLocale: 'en-GB',
                targetDocument: document.implementation.createHTMLDocument('t'),
            };

            await activateLocale({ ...shared, locale: 'en-GB', direction: 'ltr' });

            const switcher = createLocaleSwitcher({
                ...shared,
                localeService: buildLocaleService(),
                supported: { 'en-GB': { direction: 'ltr' }, 'fr-FR': { direction: 'ltr' } },
            });

            await switcher.switchTo('fr-FR');
            await switcher.switchTo('en-GB');
            await switcher.switchTo('fr-FR');

            expect(calls).toStrictEqual(['shared:en-GB', 'module:en-GB', 'shared:fr-FR', 'module:fr-FR']);
            expect(switcher.current.value).toBe('fr-FR');
        });

        it('shares one load between concurrent switches to the same locale', async () => {
            const french = deferredLoader();
            const load = vi.fn(french.load);
            const { switcher } = buildSwitcher({ 'fr-FR': load });

            const first = switcher.switchTo('fr-FR');
            const second = switcher.switchTo('fr-FR');

            french.resolve({ hi: 'Salut' });
            await Promise.all([first, second]);

            expect(load).toHaveBeenCalledTimes(1);
            expect(switcher.current.value).toBe('fr-FR');
        });

        it('starts the active and fallback loads together', () => {
            const started: string[] = [];

            /**
             * Build a loader that records its start and never settles.
             */
            const pending = (locale: string) => () => {
                started.push(locale);

                return new Promise<Record<string, string>>(() => undefined);
            };
            const { switcher } = buildSwitcher({ 'fr-FR': pending('fr-FR'), 'en-GB': pending('en-GB') });

            void switcher.switchTo('fr-FR');

            expect(started).toStrictEqual(['fr-FR', 'en-GB']);
        });

        it('switches to a locale whose fallback fails, reporting the fallback', async () => {
            const failure = new Error('offline');
            const onFallbackError = vi.fn();
            const { storage, switcher } = buildSwitcher(
                { 'fr-FR': async () => ({ hi: 'Salut' }), 'en-GB': () => Promise.reject(failure) },
                { onFallbackError },
            );

            await switcher.switchTo('fr-FR');

            await vi.waitFor(() => {
                expect(onFallbackError).toHaveBeenCalledWith(failure, 'en-GB');
            });

            expect(switcher.current.value).toBe('fr-FR');
            expect(storage.get('locale')).toBe('fr-FR');
        });

        it('switches without waiting for a fallback that has not loaded', async () => {
            const { switcher } = buildSwitcher({
                'fr-FR': async () => ({ hi: 'Salut' }),
                'en-GB': () => new Promise<Record<string, string>>(() => undefined),
            });

            await switcher.switchTo('fr-FR');

            expect(switcher.current.value).toBe('fr-FR');
        });

        it('retries a failed fallback on the next switch', async () => {
            let attempts = 0;
            const onFallbackError = vi.fn();
            const { i18n, switcher } = buildSwitcher(
                {
                    'fr-FR': async () => ({ hi: 'Salut' }),
                    'ar-SA': async () => ({ hi: 'مرحبا' }),
                    'en-GB': () => {
                        attempts += 1;

                        return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ hi: 'Hi' });
                    },
                },
                { onFallbackError },
            );

            await switcher.switchTo('fr-FR');
            await vi.waitFor(() => {
                expect(onFallbackError).toHaveBeenCalledOnce();
            });
            await switcher.switchTo('ar-SA');

            await vi.waitFor(() => {
                expect(i18n.global.getLocaleMessage('en-GB')).toEqual({ hi: 'Hi' });
            });

            expect(attempts).toBe(2);
            expect(onFallbackError).toHaveBeenCalledOnce();
        });

        it('retries a failed fallback when switching to a locale already loaded', async () => {
            let attempts = 0;
            const { i18n, switcher } = buildSwitcher({
                'fr-FR': async () => ({ hi: 'Salut' }),
                'en-GB': () => {
                    attempts += 1;

                    return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ hi: 'Hi' });
                },
            });

            await switcher.switchTo('fr-FR');
            await new Promise(resolve => setTimeout(resolve, 0));
            await switcher.switchTo('fr-FR');

            await vi.waitFor(() => {
                expect(i18n.global.getLocaleMessage('en-GB')).toEqual({ hi: 'Hi' });
            });

            expect(attempts).toBe(2);
        });

        it('reports a fallback load shared by concurrent switches once', async () => {
            const english = deferredLoader();
            const onFallbackError = vi.fn();
            const { switcher } = buildSwitcher(
                {
                    'fr-FR': async () => ({ hi: 'Salut' }),
                    'ar-SA': async () => ({ hi: 'مرحبا' }),
                    'en-GB': english.load,
                },
                { onFallbackError },
            );

            await Promise.all([switcher.switchTo('fr-FR'), switcher.switchTo('ar-SA')]);

            english.reject(new Error('offline'));

            await vi.waitFor(() => {
                expect(onFallbackError).toHaveBeenCalledOnce();
            });
            await Promise.resolve();

            expect(onFallbackError).toHaveBeenCalledOnce();
        });

        it('preloads a locale and its fallback without activating or persisting it', async () => {
            const french = vi.fn(async () => ({ hi: 'Salut' }));
            const english = vi.fn(async () => ({ hi: 'Hi' }));
            const { i18n, storage, target, switcher } = buildSwitcher({ 'fr-FR': french, 'en-GB': english });

            const prepared = switcher.preload('fr');

            expect(prepared.locale).toBe('fr-FR');
            expect(french).toHaveBeenCalledOnce();
            expect(english).toHaveBeenCalledOnce();

            await vi.waitFor(() => {
                expect(i18n.global.getLocaleMessage('fr-FR')).toEqual({ hi: 'Salut' });
            });

            expect(switcher.current.value).toBe('en-GB');
            expect(target.documentElement.getAttribute('lang')).toBeNull();

            await prepared.activate();

            expect(switcher.current.value).toBe('fr-FR');
            expect(target.documentElement.getAttribute('lang')).toBe('fr-FR');
            expect(storage.get('locale')).toBe('en-GB');
        });

        it('shares the first activation of a preloaded locale', async () => {
            const { switcher } = buildSwitcher({ 'fr-FR': async () => ({ hi: 'Salut' }) });
            const prepared = switcher.preload('fr-FR');

            expect(prepared.activate()).toBe(prepared.activate());

            await prepared.activate();
        });

        it('throws when preloading a locale that matches no enabled locale', () => {
            const { switcher } = buildSwitcher({});

            expect(() => switcher.preload('de-DE')).toThrow(I18nError);
        });

        it('holds a failed preload until it is activated', async () => {
            const unhandled = vi.fn();

            process.on('unhandledRejection', unhandled);

            try {
                const { switcher } = buildSwitcher({ 'fr-FR': () => Promise.reject(new Error('offline')) });
                const prepared = switcher.preload('fr-FR');

                await new Promise(resolve => setTimeout(resolve, 0));

                expect(unhandled).not.toHaveBeenCalled();

                await expect(prepared.activate()).rejects.toThrow('offline');
                expect(switcher.current.value).toBe('en-GB');
            } finally {
                process.off('unhandledRejection', unhandled);
            }
        });

        it('rejects the activation of a preload whose load already failed, without retrying', async () => {
            const failure = new Error('offline');
            let attempts = 0;
            const { switcher } = buildSwitcher({
                'fr-FR': () => {
                    attempts += 1;

                    return attempts === 1 ? Promise.reject(failure) : Promise.resolve({ hi: 'Salut' });
                },
            });
            const prepared = switcher.preload('fr-FR');

            await new Promise(resolve => setTimeout(resolve, 0));

            await expect(prepared.activate()).rejects.toBe(failure);
            expect(attempts).toBe(1);
            expect(switcher.current.value).toBe('en-GB');
        });

        it('applies nothing for a preloaded locale a later switch supersedes', async () => {
            const french = deferredLoader();
            const { switcher } = buildSwitcher({ 'fr-FR': french.load, 'ar-SA': async () => ({ hi: 'مرحبا' }) });
            const activation = switcher.preload('fr-FR').activate();

            await switcher.switchTo('ar-SA');
            french.resolve({ hi: 'Salut' });
            await activation;

            expect(switcher.current.value).toBe('ar-SA');
        });

        it('loads a fallback still loading from a preload only once', async () => {
            const english = deferredLoader();
            const englishLoad = vi.fn(english.load);
            const { switcher } = buildSwitcher({
                'fr-FR': async () => ({ hi: 'Salut' }),
                'ar-SA': async () => ({ hi: 'مرحبا' }),
                'en-GB': englishLoad,
            });

            await switcher.preload('fr-FR').activate();
            await switcher.switchTo('ar-SA');
            english.resolve({ hi: 'Hi' });

            expect(englishLoad).toHaveBeenCalledOnce();
        });

        it('does not report the default locale failing to load as a fallback failure', async () => {
            const onFallbackError = vi.fn();
            const { switcher } = buildSwitcher(
                { 'en-GB': () => Promise.reject(new Error('offline')) },
                { onFallbackError },
            );

            await expect(switcher.switchTo('en-GB')).rejects.toThrow('offline');
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(onFallbackError).not.toHaveBeenCalled();
        });

        it('loads no fallback when no fallback locale is given', async () => {
            const english = vi.fn(async () => ({ hi: 'Hi' }));
            const switcher = createLocaleSwitcher({
                i18n: createApplicationI18n('en-GB'),
                modules: [],
                sharedLoaders: { 'fr-FR': async () => ({ hi: 'Salut' }), 'en-GB': english },
                localeService: new LocaleService({
                    defaultLocale: 'en-GB',
                    enabledLocales: ['en-GB', 'fr-FR'],
                    storage: new MemoryStorage(),
                }),
                supported: { 'en-GB': { direction: 'ltr' }, 'fr-FR': { direction: 'ltr' } },
                targetDocument: document.implementation.createHTMLDocument('t'),
            });

            await switcher.switchTo('fr-FR');

            expect(english).not.toHaveBeenCalled();
        });
    });
});

describe('createLocaleSwitcher with modules loaded on demand', () => {
    /** A loader whose loads the test settles on demand, per locale. */
    interface ControlledLoader {
        /** The module loader. */
        readonly load: (locale: string) => Promise<Record<string, string>>;

        /** The locales requested so far, in order. */
        readonly requested: string[];

        /**
         * Resolve the pending load for `locale`.
         */
        resolve(locale: string): void;

        /**
         * Reject the pending load for `locale`.
         */
        reject(locale: string, error: Error): void;
    }

    /** The callbacks settling one pending load. */
    interface PendingLoad {
        /** Fulfil the load with messages. */
        readonly resolve: (value: Record<string, string>) => void;

        /** Reject the load. */
        readonly reject: (error: Error) => void;
    }

    /** Build a module loader whose loads the test settles. */
    function controlledLoader(): ControlledLoader {
        const pending = new Map<string, PendingLoad>();
        const requested: string[] = [];

        return {
            requested,
            load: locale => {
                requested.push(locale);

                return new Promise((resolve, reject) => {
                    pending.set(locale, { resolve, reject });
                });
            },
            resolve: locale => pending.get(locale)?.resolve({ title: `users-${locale}` }),
            reject: (locale, error) => pending.get(locale)?.reject(error),
        };
    }

    /** Build a switcher over three locales whose `users` module loads on demand. */
    function build(users: (locale: string) => Promise<Record<string, string> | null>) {
        const i18n = createApplicationI18n('en-GB');
        const shell = vi.fn(async (locale: string) => ({ title: `shell-${locale}` }));
        const switcher = createLocaleSwitcher({
            i18n,
            modules: [
                { name: 'shell', routes: [], locales: shell },
                { name: 'users', routes: [], locales: users },
            ],
            localeService: new LocaleService({
                defaultLocale: 'en-GB',
                enabledLocales: ['en-GB', 'fr-FR', 'ar-SA'],
                storage: new MemoryStorage(),
            }),
            supported: { 'en-GB': { direction: 'ltr' }, 'fr-FR': { direction: 'ltr' }, 'ar-SA': { direction: 'rtl' } },
            fallbackLocale: 'en-GB',
            initialModules: ['shell'],
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        return { i18n, shell, switcher };
    }

    /** The `users` title installed for `locale`, if any. */
    function usersTitle(i18n: ReturnType<typeof createApplicationI18n>, locale: string): unknown {
        return (i18n.global.getLocaleMessage(locale) as Record<string, Record<string, string> | undefined>)['users']?.[
            'title'
        ];
    }

    it('switches with the initial modules only', async () => {
        const users = vi.fn(async () => ({ title: 'Users' }));
        const { i18n, shell, switcher } = build(users);

        await switcher.switchTo('fr-FR');

        expect(shell.mock.calls).toEqual([['fr-FR'], ['en-GB']]);
        expect(users).not.toHaveBeenCalled();
        expect(i18n.global.t('shell.title')).toBe('shell-fr-FR');
    });

    it('loads a module for the active locale and its fallback, then keeps it through switches', async () => {
        const users = vi.fn(async (locale: string) => ({ title: `users-${locale}` }));
        const { i18n, switcher } = build(users);

        await switcher.switchTo('fr-FR');
        await switcher.loadModules(['users']);

        expect(usersTitle(i18n, 'fr-FR')).toBe('users-fr-FR');

        await vi.waitFor(() => {
            expect(usersTitle(i18n, 'en-GB')).toBe('users-en-GB');
        });

        await switcher.switchTo('ar-SA');

        expect(usersTitle(i18n, 'ar-SA')).toBe('users-ar-SA');
    });

    it('holds a switch until a module requested meanwhile loads for the new locale', async () => {
        const users = controlledLoader();
        const { i18n, switcher } = build(users.load);
        const navigation = switcher.loadModules(['users']);
        const switching = switcher.switchTo('fr-FR');

        await vi.waitFor(() => {
            expect(users.requested).toContain('fr-FR');
        });

        users.resolve('en-GB');
        await navigation;

        expect(switcher.current.value).toBe('en-GB');

        users.resolve('fr-FR');
        await switching;

        expect(switcher.current.value).toBe('fr-FR');
        expect(usersTitle(i18n, 'fr-FR')).toBe('users-fr-FR');
    });

    it('loads a module again for a locale that a switch activated while it loaded', async () => {
        const users = controlledLoader();
        const { i18n, switcher } = build(users.load);
        const navigation = switcher.loadModules(['users']);
        const switching = switcher.switchTo('fr-FR');

        await vi.waitFor(() => {
            expect(users.requested).toContain('fr-FR');
        });

        users.resolve('fr-FR');
        await switching;
        users.resolve('en-GB');
        await navigation;

        expect(users.requested).toEqual(['en-GB', 'fr-FR']);
        expect(usersTitle(i18n, 'fr-FR')).toBe('users-fr-FR');
    });

    it('loads a module again for a locale set directly while it loaded', async () => {
        const users = controlledLoader();
        const { i18n, switcher } = build(users.load);
        const navigation = switcher.loadModules(['users']);

        i18n.global.locale.value = 'fr-FR';
        users.resolve('en-GB');

        await vi.waitFor(() => {
            expect(users.requested).toEqual(['en-GB', 'fr-FR']);
        });

        users.resolve('fr-FR');
        await navigation;

        expect(usersTitle(i18n, 'fr-FR')).toBe('users-fr-FR');
    });

    it('stops holding a switch for a request whose signal aborts', async () => {
        const users = controlledLoader();
        const { switcher } = build(users.load);
        const interest = new AbortController();
        const navigation = switcher.loadModules(['users'], interest.signal);

        navigation.catch(() => undefined);

        const switching = switcher.switchTo('fr-FR');

        await vi.waitFor(() => {
            expect(users.requested).toContain('fr-FR');
        });

        interest.abort();
        await switching;

        expect(switcher.current.value).toBe('fr-FR');
    });

    it('does not keep a module whose request aborted', async () => {
        const users = vi.fn(async (locale: string) => ({ title: `users-${locale}` }));
        const { switcher } = build(users);
        const interest = new AbortController();
        const navigation = switcher.loadModules(['users'], interest.signal);

        interest.abort();
        await navigation;
        await switcher.switchTo('fr-FR');

        expect(users.mock.calls).toEqual([['en-GB']]);
    });

    it('rejects with the error a module failed to load with, and keeps nothing', async () => {
        const failure = new Error('Failed to fetch dynamically imported module: /assets/users.js');
        const users = vi.fn((locale: string) =>
            locale === 'en-GB' ? Promise.reject(failure) : Promise.resolve({ title: locale }),
        );
        const { switcher } = build(users);

        await expect(switcher.loadModules(['users'])).rejects.toBe(failure);
        await switcher.switchTo('fr-FR');

        expect(users.mock.calls).toEqual([['en-GB']]);
    });

    it('reports a module that fails to load for the fallback without failing the load', async () => {
        const failure = new Error('offline');
        const onFallbackError = vi.fn();
        const i18n = createApplicationI18n('en-GB');
        const switcher = createLocaleSwitcher({
            i18n,
            modules: [
                {
                    name: 'users',
                    routes: [],
                    locales: locale =>
                        locale === 'en-GB' ? Promise.reject(failure) : Promise.resolve({ title: 'Utilisateurs' }),
                },
            ],
            localeService: new LocaleService({
                defaultLocale: 'en-GB',
                enabledLocales: ['en-GB', 'fr-FR'],
                storage: new MemoryStorage(),
            }),
            supported: { 'en-GB': { direction: 'ltr' }, 'fr-FR': { direction: 'ltr' } },
            fallbackLocale: 'en-GB',
            initialModules: [],
            onFallbackError,
            targetDocument: document.implementation.createHTMLDocument('t'),
        });

        await switcher.switchTo('fr-FR');
        await switcher.loadModules(['users']);

        await vi.waitFor(() => {
            expect(onFallbackError).toHaveBeenCalledWith(failure, 'en-GB');
        });

        expect(i18n.global.t('users.title')).toBe('Utilisateurs');
    });

    it('prefetches modules with a preload without holding its activation', async () => {
        const users = controlledLoader();
        const { switcher } = build(users.load);
        const prepared = switcher.preload('fr-FR', ['users']);

        expect(users.requested).toEqual(['fr-FR']);

        await prepared.activate();

        expect(switcher.current.value).toBe('fr-FR');

        users.reject('fr-FR', new Error('offline'));
        await new Promise(resolve => setTimeout(resolve, 0));
    });
});
