/**
 * Locale wiring for the bootstrap preset.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type {
    ApplicationI18n,
    FallbackErrorHandler,
    LocaleFormats,
    LocaleSwitcher,
    ModuleMessageLoader,
} from '../i18n/application-i18n';
import { createApplicationI18n, createLocaleSwitcher } from '../i18n/application-i18n';
import { I18nError } from '@sinemacula/foundation/i18n/i18n-error';
import { LocaleService } from '@sinemacula/foundation/i18n/locale-service';
import type { LocaleMessages, ModuleDefinition } from '../module/module';
import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';
import { installLocaleSwitcher } from './services';

/**
 * The configuration slice the locale wiring reads.
 */
export interface LocaleWiringConfig {
    /** Locale identity: default, enabled list, and per-locale metadata. */
    readonly locales: {
        /** The default locale applied before any preference resolves. */
        readonly default: string;

        /** The locales the application enables, as BCP 47 tags. */
        readonly enabled: readonly string[];

        /** Per-locale metadata keyed by locale tag. */
        readonly supported: Readonly<
            Record<
                string,
                {
                    /** The locale's text direction. */
                    readonly direction: 'ltr' | 'rtl';
                }
            >
        >;
    };
}

/**
 * Options for {@link wireLocale}.
 */
export interface WireLocaleOptions {
    /** The configuration slice the locale wiring reads. */
    readonly config: LocaleWiringConfig;

    /** The registry's ordered module list, the source of module translations. */
    readonly modules: readonly ModuleDefinition[];

    /** Shared (non-module) translation loaders keyed by locale. */
    readonly sharedLoaders?: Readonly<Record<string, () => Promise<LocaleMessages>>>;

    /** Datetime and number formats installed on the i18n instance. */
    readonly formats?: LocaleFormats;

    /** The storage key the locale preference persists under. Default 'locale'. */
    readonly localeStorageKey?: string;

    /** Behaviour when a module name shadows a shared top-level translation key. Default 'error' throws; 'module-wins' lets module messages shadow the key. */
    readonly duplicateNamespaceStrategy?: 'error' | 'module-wins';

    /** Whether a non-default locale also loads the default locale's messages as its fallback. Default true. */
    readonly loadFallbackMessages?: boolean;

    /** The modules whose messages load with every locale; others load on demand. Defaults to every module. */
    readonly initialModules?: readonly string[];

    /** Modules whose messages also start loading for the detected locale, without holding its activation. */
    readonly prefetchModules?: readonly string[];

    /** Told when the default locale's messages fail to load as a fallback. */
    readonly onFallbackError?: FallbackErrorHandler;

    /** The storage the locale preference is read from and persisted to. */
    readonly storage: KeyValueStorage;

    /** Preferred locales, most preferred first (typically `navigator.languages`). */
    readonly localeCandidates: readonly string[];

    /** The document whose `lang`/`dir` attributes are synchronised. */
    readonly targetDocument?: Document;
}

/**
 * The wired i18n instance and its runtime locale switcher.
 */
export interface WiredLocale {
    /** The wired i18n instance. */
    readonly i18n: ApplicationI18n;

    /** The installed runtime locale switcher, which also loads modules' messages on demand. */
    readonly switcher: LocaleSwitcher & ModuleMessageLoader;
}

/**
 * The locale wiring, started: the detected locale's messages are loading, and
 * nothing is active yet.
 */
export interface StartedLocale {
    /**
     * Activate the detected locale once its own messages load, then install the
     * switcher; repeat calls share the first.
     *
     * @throws the error the detected locale's own messages failed to load with
     */
    wire(): Promise<WiredLocale>;
}

/**
 * Detect the locale and start loading its messages, with the default as
 * fallback unless fallback loading is off, through the switcher it will later
 * install, so the switcher never loads them again.
 */
export function startLocale(options: WireLocaleOptions): StartedLocale {
    const locales = options.config.locales;
    const i18n = createApplicationI18n(locales.default, options.formats);
    const localeService = new LocaleService({
        defaultLocale: locales.default,
        enabledLocales: locales.enabled,
        storage: options.storage,
        ...(options.localeStorageKey === undefined ? {} : { storageKey: options.localeStorageKey }),
    });
    const switcher = createLocaleSwitcher({
        i18n,
        modules: options.modules,
        ...(options.sharedLoaders === undefined ? {} : { sharedLoaders: options.sharedLoaders }),
        localeService,
        supported: locales.supported,
        ...(options.loadFallbackMessages === false ? {} : { fallbackLocale: locales.default }),
        onNamespaceCollision: options.duplicateNamespaceStrategy ?? 'error',
        ...(options.onFallbackError === undefined ? {} : { onFallbackError: options.onFallbackError }),
        ...(options.initialModules === undefined ? {} : { initialModules: options.initialModules }),
        ...(options.targetDocument === undefined ? {} : { targetDocument: options.targetDocument }),
    });
    const prepared = switcher.preload(localeService.detect(options.localeCandidates), options.prefetchModules);
    let wired: Promise<WiredLocale> | null = null;

    return {
        wire: () =>
            (wired ??= prepared.activate().then(() => {
                installLocaleSwitcher(switcher);

                return { i18n, switcher };
            })),
    };
}

/**
 * Start the locale wiring and wire it straight away.
 *
 * @throws Error when the collision strategy is 'error' and a module name equals
 * a shared top-level translation key
 */
export function wireLocale(options: WireLocaleOptions): Promise<WiredLocale> {
    return startLocale(options).wire();
}

/**
 * Check the defined configuration declares the locales the boot started with:
 * the same default, enabled list in order, and supported locales and
 * directions.
 *
 * @throws {@link I18nError} when they differ
 */
export function assertSameLocales(
    defined: LocaleWiringConfig['locales'],
    declared: LocaleWiringConfig['locales'],
): void {
    if (
        defined.default !== declared.default ||
        defined.enabled.join() !== declared.enabled.join() ||
        supportedDirections(defined) !== supportedDirections(declared)
    ) {
        throw new I18nError('The defined config declares different locales from the i18n.locales boot option.');
    }
}

/**
 * The supported locales and their directions, in a comparable form.
 */
function supportedDirections(locales: LocaleWiringConfig['locales']): string {
    return JSON.stringify(
        Object.entries(locales.supported)
            .map(([locale, { direction }]) => [locale, direction])
            .sort(),
    );
}
