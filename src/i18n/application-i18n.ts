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

    /** Told when the fallback locale's messages fail to load; without it the failure is dropped. */
    readonly onFallbackError?: FallbackErrorHandler;

    /** The document whose `lang`/`dir` attributes are set. Defaults to the global document. */
    readonly targetDocument?: Document;

    /** Replaces the default module-message loading for both the active and fallback locale. */
    readonly messageSource?: ModuleMessageSource;

    /** When a module name equals a shared top-level key: 'module-wins' (default) shadows the shared key, 'error' throws an `I18nError`. */
    readonly onNamespaceCollision?: 'module-wins' | 'error';
}

/**
 * Told when a fallback locale's messages fail to load.
 */
export type FallbackErrorHandler = (error: unknown, locale: string) => void;

/**
 * Install the messages for `locale` and activate it, setting the document
 * `lang`/`dir`. The fallback locale's messages, when it differs, load alongside
 * but never hold back or fail the activation.
 */
export async function activateLocale(options: ActivateLocaleOptions): Promise<void> {
    const own = installLocaleMessages(options, options.locale);
    const fallback = fallbackToLoad(options);

    if (fallback !== null) {
        reportFallbackFailure(installLocaleMessages(options, fallback), fallback, options.onFallbackError);
    }

    await own;

    applyLocale(options);
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

    /** The fallback locale whose messages are also loaded; none are when omitted. */
    readonly fallbackLocale?: string;

    /** The document whose `lang`/`dir` attributes are set. Defaults to the global document. */
    readonly targetDocument?: Document;

    /** Forwarded to {@link activateLocale} on every switch. */
    readonly messageSource?: ModuleMessageSource;

    /** Forwarded to {@link activateLocale} on every switch. */
    readonly onNamespaceCollision?: 'module-wins' | 'error';

    /** Told once per failed load of the fallback locale's messages. */
    readonly onFallbackError?: FallbackErrorHandler;
}

/**
 * A runtime locale switcher bound to one i18n instance.
 */
export interface LocaleSwitcher {
    /** The active locale, reactive to changes made through {@link switchTo}. */
    readonly current: ComputedRef<string>;

    /**
     * Match `locale` against the enabled locales, load its messages, then
     * activate and persist it; a call superseded by a later one before its
     * messages load applies and persists nothing, and still rejects if its own
     * load fails. The fallback's messages load alongside without holding the
     * switch back.
     *
     * @throws {@link I18nError} when `locale` does not match any enabled locale
     */
    switchTo(locale: string): Promise<void>;
}

/**
 * Build a runtime locale switcher that activates through the same path as
 * boot; locales already installed on the instance, and each locale it loads,
 * are not loaded again.
 */
export function createLocaleSwitcher(options: LocaleSwitcherOptions): LocaleSwitcher {
    const current = computed(() => options.i18n.global.locale.value);
    const ensureInstalled = createOnceInstaller(options.i18n.global.availableLocales);
    const observeFallback = createFallbackObserver(options.onFallbackError);
    let latestSwitch: object | null = null;

    return {
        current,
        async switchTo(locale: string): Promise<void> {
            const matched = options.localeService.match(locale);

            if (matched === null) {
                throw new I18nError(`Cannot switch to locale "${locale}": it is not an enabled locale.`);
            }

            const ticket = {};

            latestSwitch = ticket;

            const activation = switchActivation(options, matched);
            const own = ensureInstalled(activation, matched);
            const fallback = fallbackToLoad(activation);

            if (fallback !== null) {
                observeFallback(ensureInstalled(activation, fallback), fallback);
            }

            await own;

            if (ticket !== latestSwitch) {
                return;
            }

            applyLocale(activation);
            options.localeService.persist(matched);
        },
    };
}

/**
 * The activation a switch to the matched locale runs.
 */
function switchActivation(options: LocaleSwitcherOptions, matched: string): ActivateLocaleOptions {
    return {
        i18n: options.i18n,
        modules: options.modules,
        ...(options.sharedLoaders === undefined ? {} : { sharedLoaders: options.sharedLoaders }),
        locale: matched,
        direction: options.supported[matched]?.direction ?? 'ltr',
        ...(options.fallbackLocale === undefined ? {} : { fallbackLocale: options.fallbackLocale }),
        ...(options.targetDocument === undefined ? {} : { targetDocument: options.targetDocument }),
        ...(options.messageSource === undefined ? {} : { messageSource: options.messageSource }),
        ...(options.onNamespaceCollision === undefined ? {} : { onNamespaceCollision: options.onNamespaceCollision }),
    };
}

/**
 * Build an observer that reports each fallback load's failure once, however
 * many switches share the load.
 */
function createFallbackObserver(
    onError: FallbackErrorHandler | undefined,
): (loading: Promise<void>, locale: string) => void {
    const observed = new WeakSet<Promise<void>>();

    return (loading, locale) => {
        if (!observed.has(loading)) {
            observed.add(loading);
            reportFallbackFailure(loading, locale, onError);
        }
    };
}

/**
 * Build an installer that loads each locale's messages once, sharing a load
 * already in flight and retrying one that failed.
 */
function createOnceInstaller(
    alreadyInstalled: readonly string[],
): (activation: ActivateLocaleOptions, locale: string) => Promise<void> {
    const installed = new Set<string>(alreadyInstalled);
    const loading = new Map<string, Promise<void>>();

    return (activation, locale) => {
        if (installed.has(locale)) {
            return Promise.resolve();
        }

        const pending =
            loading.get(locale) ??
            installLocaleMessages(activation, locale)
                .then(() => {
                    installed.add(locale);
                })
                .finally(() => {
                    loading.delete(locale);
                });

        loading.set(locale, pending);

        return pending;
    };
}

/**
 * The fallback locale whose messages load alongside, or null when there is none
 * or it is the locale being activated.
 */
function fallbackToLoad(options: ActivateLocaleOptions): string | null {
    const fallback = options.fallbackLocale;

    return fallback === undefined || fallback === options.locale ? null : fallback;
}

/**
 * Hand a fallback load's failure to the handler, so it never rejects
 * unobserved, even when the handler throws.
 */
function reportFallbackFailure(
    loading: Promise<void>,
    locale: string,
    onError: FallbackErrorHandler | undefined,
): void {
    loading.catch((error: unknown) => {
        try {
            onError?.(error, locale);
        } catch {
            // Reporting is best-effort; the activation already went ahead.
        }
    });
}

/**
 * Activate the locale on the instance and set the document `lang`/`dir`.
 */
function applyLocale(options: ActivateLocaleOptions): void {
    options.i18n.global.locale.value = options.locale;

    const target = options.targetDocument ?? globalThis.document;

    target.documentElement.setAttribute('lang', options.locale);
    target.documentElement.setAttribute('dir', options.direction);
}

/**
 * Load one locale's shared and module translations and install the merge.
 *
 * @throws {@link I18nError} when collisions are set to error and one occurs
 */
async function installLocaleMessages(options: ActivateLocaleOptions, locale: string): Promise<void> {
    const sharedLoader = options.sharedLoaders?.[locale];
    const [shared, moduleMessages] = await Promise.all([
        sharedLoader === undefined ? {} : sharedLoader(),
        options.messageSource === undefined
            ? collectModuleMessages(options.modules, locale)
            : options.messageSource.messages(locale),
    ]);

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
