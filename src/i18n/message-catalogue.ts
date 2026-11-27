/**
 * Per-locale message installation in parts: the shared messages and each
 * module's, loaded independently and composed onto the i18n instance.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { I18nError } from '@sinemacula/foundation/i18n/i18n-error';

import type { LocaleMessages, ModuleDefinition } from '../module/module';
import type { ModuleMessageSource } from '../module/module-registry';
import type { ApplicationI18n } from './application-i18n';

/** The shared messages' part. */
const SHARED = Symbol('shared');

/** Every module's messages at once, from a custom message source. */
const ALL_MODULES = Symbol('all-modules');

/**
 * One independently loaded slice of a locale's messages.
 */
type Part = string | typeof SHARED | typeof ALL_MODULES;

/**
 * Where a catalogue loads its messages from and how it composes them.
 */
export interface MessageCatalogueOptions {
    /** The i18n instance messages are installed on. */
    readonly i18n: ApplicationI18n;

    /** The modules whose per-locale messages are loaded. */
    readonly modules: readonly ModuleDefinition[];

    /** Host-provided loaders for the shared translations, keyed by locale. */
    readonly sharedLoaders?: Readonly<Record<string, () => Promise<LocaleMessages>>>;

    /** Loads every module's messages with the locale, in place of loading each module's on its own. */
    readonly messageSource?: ModuleMessageSource;

    /** When a module name equals a shared top-level key: 'module-wins' (default) shadows the shared key, 'error' throws an `I18nError`. */
    readonly onNamespaceCollision?: 'module-wins' | 'error';
}

/**
 * Loads each locale's messages in parts, each part at most once: a load in
 * flight is shared and a failed one is retried. Every installed part recomposes
 * the locale's messages; a part whose composition fails is not installed.
 * Locales already on the instance when the catalogue is built are complete and
 * never recomposed.
 */
export class MessageCatalogue {
    /** Where messages load from and how they compose. */
    readonly #options: MessageCatalogueOptions;

    /** The module definitions, keyed by name. */
    readonly #modules: ReadonlyMap<string, ModuleDefinition>;

    /** The locales installed before the catalogue was built. */
    readonly #complete: ReadonlySet<string>;

    /** Each locale's installed parts and their messages, null when a module has none. */
    readonly #installed = new Map<string, ReadonlyMap<Part, LocaleMessages | null>>();

    /** Each locale's parts still loading. */
    readonly #loading = new Map<string, Map<Part, Promise<void>>>();

    constructor(options: MessageCatalogueOptions) {
        this.#options = options;
        this.#modules = new Map(options.modules.map(definition => [definition.name, definition]));
        this.#complete = new Set(options.i18n.global.availableLocales);
    }

    /**
     * Start loading `locale`'s shared messages and the named modules' that are
     * not installed yet, one load per part.
     *
     * @throws {@link I18nError} from a part's load when collisions are set to
     * error and one occurs
     */
    load(locale: string, modules: readonly string[]): Promise<void>[] {
        return this.#parts(modules)
            .filter(part => !this.#isInstalled(locale, part))
            .map(part => this.#loadPart(locale, part));
    }

    /**
     * Whether `locale`'s shared messages and the named modules' are installed.
     */
    hasLoaded(locale: string, modules: readonly string[]): boolean {
        return this.#parts(modules).every(part => this.#isInstalled(locale, part));
    }

    /**
     * The parts that make up the shared messages and the named modules'.
     */
    #parts(modules: readonly string[]): Part[] {
        return this.#options.messageSource === undefined ? [SHARED, ...modules] : [SHARED, ALL_MODULES];
    }

    /**
     * Whether a part of `locale`'s messages is installed.
     */
    #isInstalled(locale: string, part: Part): boolean {
        return this.#complete.has(locale) || this.#installed.get(locale)?.has(part) === true;
    }

    /**
     * Load and install one part, sharing a load already in flight.
     */
    #loadPart(locale: string, part: Part): Promise<void> {
        const loading = this.#loading.get(locale) ?? new Map<Part, Promise<void>>();
        const pending =
            loading.get(part) ??
            this.#fetch(locale, part)
                .then(messages => {
                    this.#install(locale, part, messages);
                })
                .finally(() => {
                    loading.delete(part);
                });

        loading.set(part, pending);
        this.#loading.set(locale, loading);

        return pending;
    }

    /**
     * Load one part's messages.
     */
    async #fetch(locale: string, part: Part): Promise<LocaleMessages | null> {
        if (part === SHARED) {
            return (await this.#options.sharedLoaders?.[locale]?.()) ?? {};
        }

        if (part === ALL_MODULES) {
            return (await this.#options.messageSource?.messages(locale)) ?? {};
        }

        return (await this.#modules.get(part)?.locales?.(locale)) ?? null;
    }

    /**
     * Compose the locale's messages with the part added and install them,
     * leaving the part uninstalled when the composition fails.
     *
     * @throws {@link I18nError} when collisions are set to error and one occurs
     */
    #install(locale: string, part: Part, messages: LocaleMessages | null): void {
        const parts = new Map(this.#installed.get(locale));

        parts.set(part, messages);

        const composed = this.#compose(locale, parts);

        this.#installed.set(locale, parts);
        this.#options.i18n.global.setLocaleMessage(locale, composed);
    }

    /**
     * Merge the shared messages with each module's under its name.
     *
     * @throws {@link I18nError} when collisions are set to error and one occurs
     */
    #compose(locale: string, parts: ReadonlyMap<Part, LocaleMessages | null>): LocaleMessages {
        const shared = parts.get(SHARED) ?? {};
        const modules: LocaleMessages = { ...parts.get(ALL_MODULES) };

        for (const [part, messages] of parts) {
            if (typeof part === 'string' && messages !== null) {
                modules[part] = messages;
            }
        }

        const collision =
            this.#options.onNamespaceCollision === 'error'
                ? Object.keys(modules).find(name => Object.hasOwn(shared, name))
                : undefined;

        if (collision !== undefined) {
            throw new I18nError(
                `Module "${collision}" collides with a shared top-level translation key for locale "${locale}".`,
            );
        }

        return { ...shared, ...modules };
    }
}
