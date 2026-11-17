/**
 * vue-i18n wiring: instance creation, locale activation and runtime switching.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ComputedRef } from 'vue';
import { computed } from 'vue';
import type { IntlDateTimeFormats, IntlNumberFormats } from 'vue-i18n';
import { createI18n } from 'vue-i18n';

import type { LocaleMessages, ModuleDefinition } from '../module/module';
import { collectModuleMessages } from '../module/module';
import type { ModuleMessageSource } from '../module/module-registry';
import { I18nError } from '@sinemacula/foundation/i18n/i18n-error';
import type { LocaleService } from '@sinemacula/foundation/i18n/locale-service';

/**
 * Datetime and number formats installed on the i18n instance, keyed by locale.
 */
export interface LocaleFormats {
    /** Datetime formats installed per locale. */
    readonly datetime?: IntlDateTimeFormats;

    /** Number formats installed per locale. */
    readonly number?: IntlNumberFormats;
}

/**
 * Build the application's vue-i18n instance, using `defaultLocale` until
 * activation and as the fallback.
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- vue-i18n's composition instance type is unnameable; see ApplicationI18n
export function createApplicationI18n(defaultLocale: string, formats?: LocaleFormats) {
    return createI18n({
        fallbackLocale: defaultLocale,
        legacy: false,
        locale: defaultLocale,
        messages: {},
        ...(formats?.datetime === undefined ? {} : { datetimeFormats: formats.datetime }),
        ...(formats?.number === undefined ? {} : { numberFormats: formats.number }),
    });
}

/**
 * The vue-i18n instance created by {@link createApplicationI18n}.
 */
export type ApplicationI18n = ReturnType<typeof createApplicationI18n>;

/**
 * Options for activating a locale on the running application.
 */
export interface ActivateLocaleOptions {
    /** The i18n instance messages are installed on. */
    readonly i18n: ApplicationI18n;

    /** The modules whose per-locale messages are loaded. */
    readonly modules: readonly ModuleDefinition[];

    /** Host-provided loaders for the shared translations, keyed by locale. */
    readonly sharedLoaders?: Readonly<Record<string, () => Promise<LocaleMessages>>>;

    /** The locale to load and activate. */
    readonly locale: string;

    /** The text direction applied to the document element. */
    readonly direction: 'ltr' | 'rtl';

    /** A fallback locale whose messages are also loaded when it differs. */
    readonly fallbackLocale?: string;

    /** The document whose `lang`/`dir` attributes are set. Defaults to the global document. */
    readonly targetDocument?: Document;

    /** Replaces the default module-message loading for both the active and fallback locale. */
    readonly messageSource?: ModuleMessageSource;

    /** When a module name equals a shared top-level key: 'module-wins' (default) shadows the shared key, 'error' throws an `I18nError`. */
    readonly onNamespaceCollision?: 'module-wins' | 'error';
}

/**
 * Install the messages for `locale`, and for `fallbackLocale` when it differs,
 * then activate `locale` and set the document `lang`/`dir`.
 */
export async function activateLocale(options: ActivateLocaleOptions): Promise<void> {
    await installLocaleMessages(options, options.locale);

    if (options.fallbackLocale !== undefined && options.fallbackLocale !== options.locale) {
        await installLocaleMessages(options, options.fallbackLocale);
    }

    options.i18n.global.locale.value = options.locale;

    const target = options.targetDocument ?? globalThis.document;

    target.documentElement.setAttribute('lang', options.locale);
    target.documentElement.setAttribute('dir', options.direction);
}

/**
 * Options for {@link createLocaleSwitcher}.
 */
export interface LocaleSwitcherOptions {
    /** The i18n instance the switcher is bound to. */
    readonly i18n: ApplicationI18n;

    /** The modules whose per-locale messages are loaded. */
    readonly modules: readonly ModuleDefinition[];

    /** Host-provided loaders for the shared translations, keyed by locale. */
    readonly sharedLoaders?: Readonly<Record<string, () => Promise<LocaleMessages>>>;

    /** Resolves, matches and persists the requested locale. */
    readonly localeService: LocaleService;

    /** Supported locales and their metadata, keyed by locale code. */
    readonly supported: Readonly<
        Record<
            string,
            {
                /** The text direction applied to the document for this locale. */
                readonly direction: 'ltr' | 'rtl';
            }
        >
    >;

    /** The fallback locale whose messages are also loaded. */
    readonly fallbackLocale: string;

    /** The document whose `lang`/`dir` attributes are set. Defaults to the global document. */
    readonly targetDocument?: Document;

    /** Forwarded to {@link activateLocale} on every switch. */
    readonly messageSource?: ModuleMessageSource;

    /** Forwarded to {@link activateLocale} on every switch. */
    readonly onNamespaceCollision?: 'module-wins' | 'error';
}

/**
 * A runtime locale switcher bound to one i18n instance.
 */
export interface LocaleSwitcher {
    /** The active locale, reactive to changes made through {@link switchTo}. */
    readonly current: ComputedRef<string>;

    /**
     * Match `locale` against the enabled locales, then persist and activate it.
     *
     * @throws {@link I18nError} when `locale` does not match any enabled locale
     */
    switchTo(locale: string): Promise<void>;
}

/**
 * Build a runtime locale switcher that activates through
 * {@link activateLocale}, the same path as boot.
 */
export function createLocaleSwitcher(options: LocaleSwitcherOptions): LocaleSwitcher {
    const current = computed(() => options.i18n.global.locale.value);

    return {
        current,
        async switchTo(locale: string): Promise<void> {
            const matched = options.localeService.match(locale);

            if (matched === null) {
                throw new I18nError(`Cannot switch to locale "${locale}": it is not an enabled locale.`);
            }

            options.localeService.persist(matched);

            await activateLocale({
                i18n: options.i18n,
                modules: options.modules,
                ...(options.sharedLoaders === undefined ? {} : { sharedLoaders: options.sharedLoaders }),
                locale: matched,
                direction: options.supported[matched]?.direction ?? 'ltr',
                fallbackLocale: options.fallbackLocale,
                ...(options.targetDocument === undefined ? {} : { targetDocument: options.targetDocument }),
                ...(options.messageSource === undefined ? {} : { messageSource: options.messageSource }),
                ...(options.onNamespaceCollision === undefined
                    ? {}
                    : { onNamespaceCollision: options.onNamespaceCollision }),
            });
        },
    };
}

/**
 * Load one locale's shared and module translations and install the merge.
 *
 * @throws {@link I18nError} when collisions are set to error and one occurs
 */
async function installLocaleMessages(options: ActivateLocaleOptions, locale: string): Promise<void> {
    const sharedLoader = options.sharedLoaders?.[locale];
    const shared = sharedLoader === undefined ? {} : await sharedLoader();
    const moduleMessages =
        options.messageSource === undefined
            ? await collectModuleMessages(options.modules, locale)
            : await options.messageSource.messages(locale);

    const collision =
        options.onNamespaceCollision === 'error'
            ? Object.keys(moduleMessages).find(name => Object.hasOwn(shared, name))
            : undefined;

    if (collision !== undefined) {
        throw new I18nError(
            `Module "${collision}" collides with a shared top-level translation key for locale "${locale}".`,
        );
    }

    options.i18n.global.setLocaleMessage(locale, { ...shared, ...moduleMessages });
}
