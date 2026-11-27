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
import { MessageCatalogue } from './message-catalogue';
import { ModuleInterest } from './module-interest';
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

    /** The modules whose messages load with every locale; others load through {@link ModuleMessageLoader.loadModules}. Defaults to every module. */
    readonly initialModules?: readonly string[];
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
 * Loads a locale's messages ahead of activating it.
 */
export interface LocalePreloader {
    /**
     * Match `locale` against the enabled locales and start loading its
     * messages, and its fallback's, without activating it; a failed load is
     * held until the preparation is activated.
     *
     * @param prefetch - modules whose messages also start loading for the
     * locale, without holding the activation back
     * @throws {@link I18nError} when `locale` does not match any enabled locale
     */
    preload(locale: string, prefetch?: readonly string[]): PreparedLocale;
}

/**
 * Loads modules' messages on demand, such as with their routes.
 */
export interface ModuleMessageLoader {
    /**
     * Load the modules' messages for the active locale, and the fallback's
     * alongside, then keep them loaded through every later switch. A switch
     * meanwhile loads them for its locale too until the signal aborts.
     *
     * @throws the error a module's messages failed to load with
     */
    loadModules(modules: readonly string[], signal?: AbortSignal): Promise<void>;
}

/**
 * A locale whose messages are loading, ready to activate.
 */
export interface PreparedLocale {
    /** The matched enabled locale. */
    readonly locale: string;

    /**
     * Activate the locale once its own messages load, without persisting it;
     * applies nothing when a later switch or activation supersedes it. Repeat
     * calls share the first.
     *
     * @throws the error its own messages failed to load with
     */
    activate(): Promise<void>;
}

/**
 * Build a runtime locale switcher that can also preload a locale to activate
 * later and load modules' messages on demand. Each locale's shared messages and
 * each module's load once; locales already installed on the instance are not
 * loaded again.
 */
export function createLocaleSwitcher(
    options: LocaleSwitcherOptions,
): LocaleSwitcher & LocalePreloader & ModuleMessageLoader {
    return new CatalogueLocaleSwitcher(options);
}

/**
 * A load that failed, holding its error.
 */
interface LoadFailure {
    /** The error the load failed with. */
    readonly error: unknown;
}

/**
 * The locale switcher over a message catalogue, tracking which modules every
 * locale needs.
 */
class CatalogueLocaleSwitcher implements LocaleSwitcher, LocalePreloader, ModuleMessageLoader {
    /** The active locale. */
    readonly current: ComputedRef<string>;

    /** The switcher's configuration. */
    readonly #options: LocaleSwitcherOptions;

    /** Loads and installs each locale's message parts. */
    readonly #catalogue: MessageCatalogue;

    /** The modules every locale needs. */
    readonly #interest: ModuleInterest;

    /** Reports each failed fallback load once. */
    readonly #observeFallback: (loading: Promise<void>, locale: string) => void;

    /** The latest activation started; an earlier one applies nothing. */
    #latestActivation: object | null = null;

    constructor(options: LocaleSwitcherOptions) {
        this.#options = options;
        this.#catalogue = new MessageCatalogue(options);
        this.#interest = new ModuleInterest(
            options.initialModules ?? options.modules.map(definition => definition.name),
        );
        this.#observeFallback = createFallbackObserver(options.onFallbackError);
        this.current = computed(() => options.i18n.global.locale.value);
    }

    /**
     * {@inheritDoc LocaleSwitcher.switchTo}
     */
    readonly switchTo = async (locale: string): Promise<void> => {
        const activation = this.#prepare(locale);

        if (await this.#applyUnlessSuperseded(activation)) {
            this.#options.localeService.persist(activation.locale);
        }
    };

    /**
     * {@inheritDoc LocalePreloader.preload}
     */
    readonly preload = (locale: string, prefetch: readonly string[] = []): PreparedLocale => {
        const activation = this.#prepare(locale);
        let failure: LoadFailure | null = null;
        let activated: Promise<void> | null = null;

        Promise.all(this.#load(activation.locale)).catch((error: unknown) => {
            failure = { error };
        });

        for (const pending of this.#catalogue.load(activation.locale, prefetch)) {
            pending.catch(() => undefined);
        }

        return {
            locale: activation.locale,

            /**
             * Activate the locale, or reject with the load that already failed.
             */
            activate: () =>
                (activated ??=
                    failure === null
                        ? this.#applyUnlessSuperseded(activation).then(() => undefined)
                        : Promise.reject(failure.error)),
        };
    };

    /**
     * {@inheritDoc ModuleMessageLoader.loadModules}
     */
    readonly loadModules = async (modules: readonly string[], signal?: AbortSignal): Promise<void> => {
        const release = this.#interest.request(modules);

        signal?.addEventListener('abort', release);

        try {
            await this.#loadForActiveLocale(modules);

            if (signal?.aborted !== true) {
                this.#interest.keep(modules);
            }
        } finally {
            signal?.removeEventListener('abort', release);
            release();
        }
    };

    /**
     * Load the modules for the active locale, again for whichever locale a
     * switch activates meanwhile.
     */
    async #loadForActiveLocale(modules: readonly string[]): Promise<void> {
        const active = this.#options.i18n.global.locale;
        let locale: string;

        do {
            locale = active.value;
            this.#loadFallback(locale, modules);

            await Promise.all(this.#catalogue.load(locale, modules));
        } while (active.value !== locale);
    }

    /**
     * The activation for the enabled locale `locale` matches.
     *
     * @throws {@link I18nError} when `locale` does not match any enabled locale
     */
    #prepare(locale: string): ActivateLocaleOptions {
        const matched = this.#options.localeService.match(locale);

        if (matched === null) {
            throw new I18nError(`Cannot switch to locale "${locale}": it is not an enabled locale.`);
        }

        return switchActivation(this.#options, matched);
    }

    /**
     * Apply the locale once the messages it requires load, including those of
     * modules required meanwhile, unless a later activation started first.
     */
    async #applyUnlessSuperseded(activation: ActivateLocaleOptions): Promise<boolean> {
        const ticket = {};

        this.#latestActivation = ticket;

        // Loading even a loaded locale retries a fallback that failed before.
        for (const pending of this.#load(activation.locale)) {
            pending.catch(() => undefined);
        }

        while (!this.#catalogue.hasLoaded(activation.locale, this.#interest.required())) {
            await Promise.race([Promise.all(this.#load(activation.locale)), this.#interest.released()]);
        }

        if (ticket !== this.#latestActivation) {
            return false;
        }

        applyLocale(activation);

        return true;
    }

    /**
     * Start loading the required messages for `locale` and its fallback.
     */
    #load(locale: string): Promise<void>[] {
        const modules = this.#interest.required();
        const loads = this.#catalogue.load(locale, modules);

        this.#loadFallback(locale, modules);

        return loads;
    }

    /**
     * Start loading the modules' messages for the fallback of `locale`.
     */
    #loadFallback(locale: string, modules: readonly string[]): void {
        const fallback = this.#options.fallbackLocale;

        if (fallback !== undefined && fallback !== locale) {
            for (const loading of this.#catalogue.load(fallback, modules)) {
                this.#observeFallback(loading, fallback);
            }
        }
    }
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
