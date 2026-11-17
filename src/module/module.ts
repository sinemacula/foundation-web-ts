/**
 * Feature module contract: routes, translations, guards, stores and hooks.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Pinia } from 'pinia';
import type { App } from 'vue';
import type { RouteRecordRaw, Router } from 'vue-router';

import type { ConfigRepository } from '@sinemacula/foundation/config/config-repository';
import type { Environment } from '@sinemacula/foundation/config/environment';
import type {
    HttpClient,
    RequestInterceptor,
    ResponseErrorHandler,
    UnauthorizedHandler,
} from '@sinemacula/foundation/http/http-client';
import type { ApplicationI18n } from '../i18n/application-i18n';
import type { RealtimeConnection } from '@sinemacula/foundation/realtime/realtime-connection';
import type { RouteMiddleware } from '../router/middleware';
import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';

/**
 * A flat or nested bag of translation key/value pairs for one locale.
 */
export type LocaleMessages = Record<string, unknown>;

/**
 * Resolves a module's translations for one locale, or null when it has none.
 */
export type LocaleMessageLoader = (locale: string) => Promise<LocaleMessages | null>;

/**
 * Removes whatever a module installed at boot (listeners, watchers, timers).
 */
export type ModuleTeardown = () => void;

/**
 * Runs a task once after a delay in milliseconds, returning a function that
 * cancels it; cancelling after it ran does nothing.
 */
export type ScheduleTask = (task: () => void, delayMs: number) => () => void;

/**
 * Platform seams resolved once by the application preset and threaded to every
 * module hook.
 */
export interface ResolvedPlatform {
    /** The fetch implementation modules use. */
    readonly fetchFn: typeof fetch;

    /** The window modules read and drive. */
    readonly targetWindow: Window;

    /** The document modules read and render into. */
    readonly targetDocument: Document;

    /** Reads the current time as epoch milliseconds. */
    readonly clock: () => number;

    /** Schedules and cancels delayed work. */
    readonly schedule: ScheduleTask;
}

/**
 * Collector handed to {@link ModuleDefinition.register}; contributions feed the
 * construction of the application HTTP client.
 */
export interface ModuleHttpRegistrar {
    /**
     * Add a request interceptor, run after the preset's, in registry order.
     */
    addRequestInterceptor(interceptor: RequestInterceptor): void;

    /**
     * Set the application's single unauthorized handler; a second call throws a
     * `ModuleRegistryError` naming both modules.
     */
    setUnauthorizedHandler(handler: UnauthorizedHandler): void;

    /**
     * Add a response-error handler, run after the preset's, in registry order.
     */
    addResponseErrorHandler(handler: ResponseErrorHandler): void;
}

/**
 * Register-phase context, handed over synchronously before shared services
 * exist.
 */
export interface ModuleRegisterContext {
    /** The application configuration repository. */
    readonly config: ConfigRepository<Record<string, unknown>>;

    /** The resolved runtime environment. */
    readonly environment: Environment;

    /** The application key/value storage. */
    readonly storage: KeyValueStorage;

    /** The application Pinia instance. */
    readonly pinia: Pinia;

    /** The resolved platform seams. */
    readonly platform: ResolvedPlatform;

    /** The HTTP machinery registrar. */
    readonly http: ModuleHttpRegistrar;
}

/**
 * Boot-phase context, handed over once the app, pinia, HTTP client, i18n and
 * router exist, before mount.
 */
export interface ModuleBootContext {
    /** The Vue application instance. */
    readonly app: App;

    /** The application router. */
    readonly router: Router;

    /** The application Pinia instance. */
    readonly pinia: Pinia;

    /** The application i18n instance. */
    readonly i18n: ApplicationI18n;

    /** The built application HTTP client. */
    readonly http: HttpClient;

    /** The application key/value storage. */
    readonly storage: KeyValueStorage;

    /** The application configuration repository. */
    readonly config: ConfigRepository<Record<string, unknown>>;

    /** The resolved platform seams. */
    readonly platform: ResolvedPlatform;

    /** The application's realtime connection, installed but not connected, or null when none. */
    readonly realtime: RealtimeConnection | null;
}

/**
 * A `defineStore` hook instantiated at the stores phase; its `$dispose` joins
 * application disposal.
 */
export type ModuleStoreFactory = (pinia: Pinia) => {
    /**
     * Dispose the store.
     */
    $dispose(): void;
};

/**
 * A self-contained feature area of the application.
 */
export interface ModuleDefinition {
    /** Unique module name, enforced by the registry; also the namespace for its translations. */
    readonly name: string;

    /** Routes contributed to the application router. */
    readonly routes: readonly RouteRecordRaw[];

    /** Lazily-loaded translations, keyed under the module name. */
    readonly locales?: LocaleMessageLoader;

    /** Global middleware run on every navigation before route `meta.middleware`, in registry order; defer store and service access to `handle()`. */
    readonly guards?: readonly RouteMiddleware[];

    /** Stores instantiated in registry order after pinia and storage install, before i18n and the router; a `useXStore` hook fits directly. */
    readonly stores?: readonly ModuleStoreFactory[];

    /** Contributes HTTP interceptors and handlers, synchronously, before the client is built. */
    readonly register?: (context: ModuleRegisterContext) => void;

    /** Installs module runtime behaviour after router creation, before mount; may return a teardown for whatever it installed. */
    readonly boot?: (context: ModuleBootContext) => ModuleTeardown | undefined | Promise<ModuleTeardown | undefined>;

    /** Marks the module owning the catch-all route, which the registry orders last; at most one per registry, and the catch-all must still be last in its own routes. */
    readonly fallback?: boolean;
}

/**
 * The default {@link ScheduleTask}, backed by the global timers.
 */
export function scheduleOnTimers(task: () => void, delayMs: number): () => void {
    const timer = setTimeout(task, delayMs);

    return () => {
        clearTimeout(timer);
    };
}

/**
 * Build a {@link LocaleMessageLoader} from per-locale dynamic importers; a
 * locale without one resolves null.
 */
export function createLocaleLoader(
    loaders: Readonly<Record<string, () => Promise<LocaleMessages>>>,
): LocaleMessageLoader {
    return async (locale: string): Promise<LocaleMessages | null> => {
        const loader = loaders[locale];

        return loader === undefined ? null : await loader();
    };
}

/**
 * Flatten every module's routes, in registry order.
 */
export function collectModuleRoutes(modules: readonly ModuleDefinition[]): RouteRecordRaw[] {
    return modules.flatMap(definition => [...definition.routes]);
}

/**
 * Load every module's translations for one locale, keyed by module name.
 */
export async function collectModuleMessages(
    modules: readonly ModuleDefinition[],
    locale: string,
): Promise<Record<string, LocaleMessages>> {
    const messages: Record<string, LocaleMessages> = {};

    for (const definition of modules) {
        const loaded = definition.locales === undefined ? null : await definition.locales(locale);

        if (loaded !== null) {
            messages[definition.name] = loaded;
        }
    }

    return messages;
}

/**
 * Flatten every module's global navigation guards, in registry order.
 */
export function collectModuleGuards(modules: readonly ModuleDefinition[]): RouteMiddleware[] {
    return modules.flatMap(definition => [...(definition.guards ?? [])]);
}
