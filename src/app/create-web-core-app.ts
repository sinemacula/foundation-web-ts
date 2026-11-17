/**
 * Bootstrap preset assembling a complete web application from the kernel.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Pinia } from 'pinia';
import { createPinia } from 'pinia';
import type { App, Component } from 'vue';
import { createApp } from 'vue';
import type { Router, RouterHistory } from 'vue-router';
import { createWebHistory } from 'vue-router';

import type { AnalyticsTracker } from '@sinemacula/foundation/analytics/analytics-tracker';
import { installPageTracking } from '@sinemacula/foundation/analytics/install-page-tracking';
import type { ConfigRepository } from '@sinemacula/foundation/config/config-repository';
import type { Environment } from '@sinemacula/foundation/config/environment';
import { RUNTIME_ENVIRONMENT_URL } from '../config/runtime-environment';
import type { ConnectivityMonitor } from '@sinemacula/foundation/connectivity/connectivity-monitor';
import type { FeatureFlags } from '@sinemacula/foundation/feature-flags/feature-flags';
import type { HttpClient, RequestInterceptor, ResponseErrorHandler } from '@sinemacula/foundation/http/http-client';
import type { ApplicationI18n, LocaleFormats, LocaleSwitcher } from '../i18n/application-i18n';
import type { Logger } from '@sinemacula/foundation/logging/logger';
import type { LocaleMessages, ModuleDefinition, ResolvedPlatform, ScheduleTask } from '../module/module';
import { scheduleOnTimers } from '../module/module';
import type { ModuleRegistry } from '../module/module-registry';
import { bootModules, createModuleRegistry, registerModules } from '../module/module-registry';
import { TeardownStack } from '../module/teardown-stack';
import { ConfirmService } from '../notifications/confirm-service';
import { ToastService } from '../notifications/toast-service';
import type { RealtimeConnection } from '@sinemacula/foundation/realtime/realtime-connection';
import type { ErrorReporter } from '@sinemacula/foundation/reporting/error-reporter';
import { NullErrorReporter } from '@sinemacula/foundation/reporting/null-error-reporter';
import { installGlobalErrorHandling } from '../reporting/install-global-error-handling';
import { tabRecoveryStorage } from '../router/chunk-error-recovery';
import { BrowserStorage } from '../storage/browser-storage';
import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import type { ColorSchemePreference } from '@sinemacula/foundation/theme/color-scheme';
import type { ColorSchemeService } from '@sinemacula/foundation/theme/color-scheme-service';
import type { UpdateMonitor } from '../updates/update-monitor';
import { installRealtime } from './services';
import { bootFoundationCore } from '@sinemacula/foundation/app/boot-foundation-core';
import type { FoundationConfig } from '@sinemacula/foundation/app/foundation-config';
import { wireChunkRecovery } from './wire-chunk-recovery';
import { wireColorScheme } from './wire-color-scheme';
import type { WireHttpClientTools } from '@sinemacula/foundation/app/wire-http-client';
import type { WiredLocale } from './wire-locale';
import { wireLocale } from './wire-locale';
import type { UpdateMonitorWiring, WiredMonitors } from './wire-monitors';
import { wireMonitors } from './wire-monitors';
import type { WiredObservability } from '@sinemacula/foundation/app/wire-observability';
import { wireRouter } from './wire-router';

const DEFAULT_MOUNT_SELECTOR = '#app';
const DISPOSED_MESSAGE = 'The application has been disposed.';
const ALREADY_STARTED_MESSAGE = 'The application has already been started.';

// Internal by design: phase insertions must never be breaking API changes.
const BOOT_PHASES = [
    'module-registry',
    'application',
    'color-scheme',
    'runtime-environment',
    'configuration',
    'storage',
    'feature-flags',
    'notifications',
    'observability',
    'register-modules',
    'http-client',
    'stores',
    'locale',
    'router',
    'error-handling',
    'realtime',
    'boot-modules',
    'chunk-recovery',
    'monitors',
] as const;

type BootPhase = (typeof BOOT_PHASES)[number];

let phaseRecorder: ((phase: BootPhase) => void) | null = null;

/**
 * Test-only: observe each executed boot phase name, in order. Phase names and
 * their order are internal and may change without notice.
 *
 * @internal
 * @returns a remover that detaches the recorder
 */
export function observeBootPhases(recorder: (phase: string) => void): () => void {
    phaseRecorder = recorder;

    return () => {
        phaseRecorder = null;
    };
}

/**
 * Report a phase to the test recorder, when one is attached.
 */
function recordPhase(phase: BootPhase): void {
    phaseRecorder?.(phase);
}

/**
 * The application handle was used outside its start-then-dispose lifecycle.
 */
export class WebCoreAppError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WebCoreAppError';
    }
}

/**
 * Configuration construction options.
 */
export interface WebCoreConfigOptions<T extends FoundationConfig> {
    /** Builds the environment from the fetched runtime document; the only place build-time variables may appear. Throw to abort boot. Pair with `createWebEnvironment` for the standard dev-chain and production required-keys behaviour. */
    readonly createEnvironment: (runtime: Readonly<Record<string, string>>) => Environment;

    /** Configuration definition over the environment; the result is deep-frozen. */
    readonly define: (environment: Environment) => T;

    /** The runtime-environment URL, also the update monitor's default poll target. Default '/runtime-env.json'. */
    readonly runtimeUrl?: string;
}

/**
 * HTTP client construction options.
 */
export interface WebCoreHttpOptions<T extends FoundationConfig> {
    /** Preset-level interceptors; module contributions are appended after these. */
    readonly interceptors?: readonly RequestInterceptor[];

    /** Full replacement of the preset response-error handler. */
    readonly onResponseError?: ResponseErrorHandler;

    /** Arms the default handler's toast; the kernel ships no translation keys. */
    readonly unexpectedErrorToastKey?: string;

    /** Full adapter override; receives the resolved construction inputs. */
    readonly client?: (tools: WireHttpClientTools<T>) => HttpClient;
}

/**
 * Internationalisation options.
 */
export interface WebCoreI18nOptions {
    /** Shared (non-module) translation loaders keyed by locale. */
    readonly sharedLoaders?: Readonly<Record<string, () => Promise<LocaleMessages>>>;

    /** Datetime and number formats installed on the i18n instance. */
    readonly formats?: LocaleFormats;

    /** The storage key the locale preference persists under. Default 'locale'. */
    readonly localeStorageKey?: string;

    /** Behaviour when a module name shadows a shared top-level translation key. Default 'error' throws; 'module-wins' lets module messages shadow the key. */
    readonly duplicateNamespaceStrategy?: 'error' | 'module-wins';
}

/**
 * Colour-scheme options.
 */
export interface WebCoreColorSchemeOptions {
    /** The preference applied when nothing is stored. Default 'system'. */
    readonly defaultPreference?: ColorSchemePreference;

    /** The storage key the preference persists under. Default 'theme'. */
    readonly storageKey?: string;

    /** The surface-page colours applied to the `theme-color` meta tag. */
    readonly themeColors?: {
        /** The colour applied in the light scheme. */
        readonly light: string;

        /** The colour applied in the dark scheme. */
        readonly dark: string;
    };
}

/**
 * Observability adapter factories; without one the local environment gets
 * console adapters and every other environment gets the null adapters.
 */
export interface WebCoreObservabilityOptions<T extends FoundationConfig> {
    /** Error-reporter factory; wins over the environment default. */
    readonly reporter?: (settings: Readonly<T>) => ErrorReporter;

    /** Analytics-tracker factory; wins over the environment default. */
    readonly analytics?: (settings: Readonly<T>) => AnalyticsTracker;

    /** Logger factory; wins over the environment default. */
    readonly logger?: (settings: Readonly<T>) => Logger;
}

/**
 * State-only notification services; rendering hosts stay application-side.
 */
export interface WebCoreNotificationOptions {
    /** Replacement toast service; defaults to a fresh state-only service. */
    readonly toasts?: ToastService;

    /** Replacement confirm service; defaults to a fresh state-only service. */
    readonly confirm?: ConfirmService;
}

/**
 * Chunk-load-failure recovery tuning.
 */
export interface WebCoreChunkRecoveryOptions {
    /** Whether recovery is installed at all. Default true. */
    readonly enabled?: boolean;

    /** Performs the recovery reload; defaults to a full document navigation. */
    readonly reload?: (path: string) => void;

    /** The reload-loop guard window in milliseconds. */
    readonly windowMs?: number;
}

/**
 * Release monitoring options.
 */
export interface WebCoreMonitorOptions<T extends FoundationConfig> {
    /** Update-monitor options; omit to take the version-derived defaults. */
    readonly updates?: UpdateMonitorWiring<T>;

    /** Connectivity monitoring; defaults to on exactly when the update monitor runs. */
    readonly connectivity?: {
        /** Whether connectivity monitoring runs. */
        readonly enabled?: boolean;
    };

    /** Chunk-load-failure recovery tuning. */
    readonly chunkRecovery?: WebCoreChunkRecoveryOptions;
}

/**
 * Platform seams threaded to every subsystem that accepts them.
 */
export interface WebCorePlatformOptions {
    /** The fetch implementation; defaults to the global `fetch`. */
    readonly fetchFn?: typeof fetch;

    /** The application storage adapter; defaults to browser local storage. */
    readonly storage?: KeyValueStorage;

    /** The window seam; defaults to the global `window`. */
    readonly targetWindow?: Window;

    /** The document seam; defaults to the global `document`. */
    readonly targetDocument?: Document;

    /** Resolves the current time; defaults to `Date.now`. */
    readonly clock?: () => number;

    /** Schedules and cancels delayed work; defaults to the global timers. */
    readonly schedule?: ScheduleTask;

    /** The router history implementation; defaults to web history. */
    readonly history?: RouterHistory;

    /** Preferred locales, most preferred first; defaults to `navigator.languages`. */
    readonly localeCandidates?: readonly string[];
}

/**
 * Options accepted by {@link createWebCoreApp}.
 */
export interface WebCoreAppOptions<T extends FoundationConfig> {
    /** Root component mounted by {@link WebCoreApp.start}. */
    readonly root: Component;

    /** Explicit ordered module list, validated by the module registry. */
    readonly modules: readonly ModuleDefinition[];

    /** Injectable for tests; defaults to a fresh pinia instance. */
    readonly pinia?: Pinia;

    /** Configuration construction options. */
    readonly config: WebCoreConfigOptions<T>;

    /** HTTP client construction options. */
    readonly http?: WebCoreHttpOptions<T>;

    /** Internationalisation options. */
    readonly i18n?: WebCoreI18nOptions;

    /** Colour-scheme options. */
    readonly colorScheme?: WebCoreColorSchemeOptions;

    /** Observability adapter factories. */
    readonly observability?: WebCoreObservabilityOptions<T>;

    /** Feature-flag provider factory; defaults to the config-driven static adapter. */
    readonly featureFlags?: (settings: Readonly<T>) => FeatureFlags;

    /** Opt-in realtime connection, installed before the modules boot, handed to them unconnected and disconnected on dispose. */
    readonly realtime?: (settings: Readonly<T>) => RealtimeConnection;

    /** State-only notification services. */
    readonly notifications?: WebCoreNotificationOptions;

    /** Release monitoring options. */
    readonly monitors?: WebCoreMonitorOptions<T>;

    /** Platform seams threaded to every subsystem. */
    readonly platform?: WebCorePlatformOptions;
}

/**
 * Direct typed references to every service the preset installed.
 */
export interface WebCoreServices<T> {
    /** The application configuration repository. */
    readonly config: ConfigRepository<T & Record<string, unknown>>;

    /** The installed HTTP client. */
    readonly http: HttpClient;

    /** The application storage adapter. */
    readonly storage: KeyValueStorage;

    /** The toast notification service. */
    readonly toasts: ToastService;

    /** The confirmation dialog service. */
    readonly confirm: ConfirmService;

    /** The installed error reporter. */
    readonly reporting: ErrorReporter;

    /** The installed analytics tracker. */
    readonly analytics: AnalyticsTracker;

    /** The installed logger. */
    readonly logger: Logger;

    /** The feature-flag provider. */
    readonly featureFlags: FeatureFlags;

    /** The runtime locale switcher. */
    readonly localeSwitcher: LocaleSwitcher;

    /** The colour-scheme service. */
    readonly colorScheme: ColorSchemeService;

    /** The realtime connection, or null when none was installed. */
    readonly realtime: RealtimeConnection | null;
}

/**
 * The assembled application handle returned by {@link createWebCoreApp}.
 */
export interface WebCoreApp<T extends FoundationConfig> {
    /** The Vue application instance. */
    readonly app: App<Element>;

    /** The application router. */
    readonly router: Router;

    /** The Pinia instance backing the stores. */
    readonly pinia: Pinia;

    /** The i18n instance. */
    readonly i18n: ApplicationI18n;

    /** The frozen configuration tree. */
    readonly config: Readonly<T>;

    /** Direct typed references to every service the preset installed. */
    readonly services: WebCoreServices<T>;

    /** The release monitors, each null when it does not run. */
    readonly monitors: {
        /** The running update monitor, or null when it does not run. */
        readonly updates: UpdateMonitor | null;

        /** The running connectivity monitor, or null when disabled. */
        readonly connectivity: ConnectivityMonitor | null;
    };

    /**
     * Mount once the router is ready, so initial navigation resolves before any
     * component renders. A handle starts at most once.
     *
     * @param selector - the mount target; default '#app'
     * @throws {WebCoreAppError} when the handle was already started, or is
     * disposed before it mounts
     */
    start(selector?: string | Element): Promise<void>;

    /**
     * Idempotently unmount the application and tear down everything the boot
     * installed, in reverse order, including the router history. Every step
     * runs even when an earlier one throws. Service holders stay installed;
     * call `resetWebCoreServices` before booting a replacement application.
     *
     * @throws the failing step's error, or an AggregateError when several
     * steps fail
     */
    dispose(): void;
}

/**
 * The kernel services and Vue application produced by the foundation phases.
 */
interface AppFoundation<T extends FoundationConfig> {
    /** The constructed runtime environment. */
    readonly environment: Environment;

    /** The frozen configuration repository. */
    readonly repository: ConfigRepository<T & Record<string, unknown>>;

    /** The frozen configuration tree. */
    readonly settings: Readonly<T>;

    /** The installed storage adapter. */
    readonly storage: KeyValueStorage;

    /** The installed colour-scheme service. */
    readonly colorScheme: ColorSchemeService;

    /** The validated module registry. */
    readonly registry: ModuleRegistry;

    /** The Vue application instance. */
    readonly app: App<Element>;

    /** The Pinia instance backing the stores. */
    readonly pinia: Pinia;

    /** The installed feature-flag provider. */
    readonly flags: FeatureFlags;

    /** The installed toast service. */
    readonly toastService: ToastService;

    /** The installed confirm service. */
    readonly confirmService: ConfirmService;

    /** The wired observability instances and breadcrumb trail. */
    readonly observability: WiredObservability;

    /** The installed HTTP client. */
    readonly http: HttpClient;
}

/**
 * The locale wiring from the module phases.
 */
interface ModuleLayer {
    /** The wired i18n instance. */
    readonly i18n: ApplicationI18n;

    /** The installed runtime locale switcher. */
    readonly switcher: LocaleSwitcher;
}

/**
 * The router and realtime connection from the app-integration phases.
 */
interface AppIntegration {
    /** The wired application router. */
    readonly router: Router;

    /** The installed realtime connection, or null when none. */
    readonly realtime: RealtimeConnection | null;
}

/**
 * Boot a web application through the kernel's phase sequence. A failed boot
 * tears down everything it installed before rethrowing the original error;
 * service holders it installed stay installed.
 *
 * @throws {ModuleRegistryError} when the module list fails validation
 * @throws {FoundationBootError} when the monitor options cannot work
 */
export async function createWebCoreApp<T extends FoundationConfig>(
    options: WebCoreAppOptions<T>,
): Promise<WebCoreApp<T>> {
    const platform = resolvePlatform(options.platform);
    const runtimeUrl = options.config.runtimeUrl ?? RUNTIME_ENVIRONMENT_URL;
    const teardowns = new TeardownStack();

    let reporter: ErrorReporter = new NullErrorReporter();

    try {
        const foundation = await bootFoundation(options, platform, runtimeUrl, teardowns);

        reporter = foundation.observability.reporter;

        const moduleLayer = await bootModuleLayer(options, platform, foundation, teardowns);
        const integration = await wireAppIntegration(options, platform, foundation, moduleLayer, teardowns);
        const monitors = wireReleaseMonitors(options, platform, runtimeUrl, foundation, integration, teardowns);

        return assembleApp(foundation, moduleLayer, integration, monitors, teardowns);
    } catch (error) {
        reportRollbackFailures(teardowns.drain(), reporter);

        throw error;
    }
}

/**
 * Report teardown failures from a boot rollback without masking the boot error.
 */
function reportRollbackFailures(failures: readonly unknown[], reporter: ErrorReporter): void {
    for (const failure of failures) {
        try {
            reporter.captureError(failure, { source: 'boot-rollback' });
        } catch {
            // The boot error is the one that must surface.
        }
    }
}

/**
 * Run the web-owned head phases, then the foundation core, bridging module
 * registration through its contributions callback so pinia and the registry
 * never cross the foundation boundary.
 */
async function bootFoundation<T extends FoundationConfig>(
    options: WebCoreAppOptions<T>,
    platform: ResolvedPlatform,
    runtimeUrl: string,
    teardowns: TeardownStack,
): Promise<AppFoundation<T>> {
    recordPhase('module-registry');

    const registry = createModuleRegistry(options.modules);

    recordPhase('application');

    const app = createApp(options.root);
    const pinia = options.pinia ?? createPinia();

    app.use(pinia);

    recordPhase('color-scheme');

    const storage = options.platform?.storage ?? resolveBrowserStorage(platform.targetWindow);
    const colorScheme = resolveColorScheme(storage, platform, options);

    teardowns.push(() => {
        colorScheme.dispose();
    });

    const toastService = options.notifications?.toasts ?? new ToastService();
    const confirmService = options.notifications?.confirm ?? new ConfirmService();

    teardowns.push(() => {
        toastService.clear();
    });
    teardowns.push(() => {
        confirmService.cancelAll();
    });

    const core = await bootFoundationCore<T>(
        {
            createEnvironment: options.config.createEnvironment,
            define: options.config.define,
            storage,
            toasts: toastService,
            confirm: confirmService,
            ...(options.featureFlags === undefined ? {} : { featureFlags: options.featureFlags }),
            ...(options.observability === undefined ? {} : { observability: options.observability }),
            ...(options.http === undefined ? {} : { http: options.http }),
            collectHttpContributions: ({ config, environment }) => {
                recordPhase('register-modules');

                return registerModules(registry.modules, { config, environment, storage, pinia, platform });
            },
            onPhase: recordPhase,
        },
        { fetchFn: platform.fetchFn },
        runtimeUrl,
    );

    return { ...core, storage, colorScheme, registry, app, pinia, toastService, confirmService };
}

/**
 * Run the module phases: instantiate eager stores and wire i18n.
 */
async function bootModuleLayer<T extends FoundationConfig>(
    options: WebCoreAppOptions<T>,
    platform: ResolvedPlatform,
    foundation: AppFoundation<T>,
    teardowns: TeardownStack,
): Promise<ModuleLayer> {
    const { settings, storage, registry, app, pinia } = foundation;

    recordPhase('stores');

    for (const definition of registry.modules) {
        for (const factory of definition.stores ?? []) {
            const handle = factory(pinia);

            teardowns.push(() => {
                handle.$dispose();
            });
        }
    }

    recordPhase('locale');

    const { i18n, switcher } = await resolveLocale(settings, registry.modules, storage, platform, options);

    app.use(i18n);

    return { i18n, switcher };
}

/**
 * Run the app-integration phases: router, error handling, page tracking,
 * realtime and module boot.
 */
async function wireAppIntegration<T extends FoundationConfig>(
    options: WebCoreAppOptions<T>,
    platform: ResolvedPlatform,
    foundation: AppFoundation<T>,
    moduleLayer: ModuleLayer,
    teardowns: TeardownStack,
): Promise<AppIntegration> {
    const { settings, repository, storage, registry, app, pinia, observability, http } = foundation;
    const { i18n } = moduleLayer;

    recordPhase('router');

    const router = resolveRouter(options, platform, foundation, i18n, teardowns);

    app.use(router);

    recordPhase('error-handling');

    teardowns.push(
        installGlobalErrorHandling({
            app,
            reporter: observability.reporter,
            trail: observability.trail,
            targetWindow: platform.targetWindow,
        }),
    );
    teardowns.push(
        installPageTracking({
            router,
            tracker: observability.analytics,
            trail: observability.trail,
        }),
    );

    recordPhase('realtime');

    const realtime = resolveRealtime(settings, options.realtime, teardowns);

    recordPhase('boot-modules');

    await bootModules(
        registry.modules,
        {
            app,
            router,
            pinia,
            i18n,
            http,
            storage,
            config: repository,
            platform,
            realtime,
        },
        teardowns,
    );

    return { router, realtime };
}

/**
 * Run the release phases: chunk-load recovery and the release monitors.
 */
function wireReleaseMonitors<T extends FoundationConfig>(
    options: WebCoreAppOptions<T>,
    platform: ResolvedPlatform,
    runtimeUrl: string,
    foundation: AppFoundation<T>,
    integration: AppIntegration,
    teardowns: TeardownStack,
): WiredMonitors {
    const { settings, observability, toastService } = foundation;
    const { router } = integration;

    recordPhase('chunk-recovery');

    const chunkRecoveryTeardown = resolveChunkRecovery(
        router,
        tabRecoveryStorage(platform.targetWindow),
        observability.reporter,
        platform.clock,
        options.monitors?.chunkRecovery,
    );

    if (chunkRecoveryTeardown !== null) {
        teardowns.push(chunkRecoveryTeardown);
    }

    recordPhase('monitors');

    const monitors = resolveMonitors(settings, runtimeUrl, platform, toastService, options.monitors);

    teardowns.push(monitors.teardown);

    return monitors;
}

/**
 * Collect the services the application handle exposes.
 */
function buildServices<T extends FoundationConfig>(
    foundation: AppFoundation<T>,
    moduleLayer: ModuleLayer,
    integration: AppIntegration,
): WebCoreServices<T> {
    const { repository, storage, colorScheme, toastService, confirmService, observability, flags } = foundation;

    return {
        config: repository,
        http: foundation.http,
        storage,
        toasts: toastService,
        confirm: confirmService,
        reporting: observability.reporter,
        analytics: observability.analytics,
        logger: observability.logger,
        featureFlags: flags,
        localeSwitcher: moduleLayer.switcher,
        colorScheme,
        realtime: integration.realtime,
    };
}

/**
 * Assemble the application handle from the results of every boot phase.
 */
function assembleApp<T extends FoundationConfig>(
    foundation: AppFoundation<T>,
    moduleLayer: ModuleLayer,
    integration: AppIntegration,
    monitors: WiredMonitors,
    teardowns: TeardownStack,
): WebCoreApp<T> {
    const { app, pinia, settings } = foundation;
    const { i18n } = moduleLayer;
    const { router } = integration;

    const disposal = new AbortController();

    let started = false;

    return {
        app,
        router,
        pinia,
        i18n,
        config: settings,
        services: buildServices(foundation, moduleLayer, integration),
        monitors: { updates: monitors.updates, connectivity: monitors.connectivity },
        async start(selector: string | Element = DEFAULT_MOUNT_SELECTOR): Promise<void> {
            if (disposal.signal.aborted) {
                throw new WebCoreAppError(DISPOSED_MESSAGE);
            }

            if (started) {
                throw new WebCoreAppError(ALREADY_STARTED_MESSAGE);
            }

            started = true;

            await Promise.race([router.isReady(), whenAborted(disposal.signal)]);

            if (disposal.signal.aborted) {
                throw new WebCoreAppError(DISPOSED_MESSAGE);
            }

            teardowns.push(() => {
                unmountIfMounted(app);
            });

            app.mount(selector);

            // A component may dispose the handle while it mounts.
            if (disposal.signal.aborted) {
                unmountIfMounted(app);

                throw new WebCoreAppError(DISPOSED_MESSAGE);
            }
        },
        dispose(): void {
            disposal.abort();
            teardowns.dispose();
        },
    };
}

/**
 * Unmount the application when it is attached to a container.
 */
function unmountIfMounted(app: App<Element>): void {
    if (app._container !== null) {
        app.unmount();
    }
}

/**
 * Resolve once the signal aborts.
 */
function whenAborted(signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        signal.addEventListener('abort', () => {
            resolve();
        });
    });
}

/**
 * Resolve the platform seams handed to every subsystem and module hook.
 */
function resolvePlatform(platform: WebCorePlatformOptions | undefined): ResolvedPlatform {
    return {
        fetchFn: platform?.fetchFn ?? ((input, init) => globalThis.fetch(input, init)),
        targetWindow: platform?.targetWindow ?? globalThis.window,
        targetDocument: platform?.targetDocument ?? globalThis.document,
        clock: platform?.clock ?? ((): number => Date.now()),
        schedule: platform?.schedule ?? scheduleOnTimers,
    };
}

/**
 * Wrap the window's local storage, falling back to in-memory storage that is
 * lost on reload when the browser blocks access to it.
 */
function resolveBrowserStorage(targetWindow: Window): KeyValueStorage {
    try {
        return new BrowserStorage(targetWindow.localStorage);
    } catch {
        return new MemoryStorage();
    }
}

/**
 * Build the router over its history and install document-title sync,
 * registering the history's release before the router can fail to build.
 */
function resolveRouter<T extends FoundationConfig>(
    options: WebCoreAppOptions<T>,
    platform: ResolvedPlatform,
    foundation: AppFoundation<T>,
    i18n: ApplicationI18n,
    teardowns: TeardownStack,
): Router {
    const history = options.platform?.history ?? createWebHistory();

    teardowns.push(() => {
        history.destroy();
    });

    const { router, titleSyncTeardown } = wireRouter({
        modules: foundation.registry.modules,
        i18n,
        appName: foundation.settings.app.name,
        history,
        targetDocument: platform.targetDocument,
    });

    teardowns.push(titleSyncTeardown);

    // A navigation still awaiting a guard must not land once the app is gone.
    teardowns.push(() => {
        router.beforeResolve(() => false);
    });

    return router;
}

/**
 * Wire and install the colour-scheme service.
 */
function resolveColorScheme<T extends FoundationConfig>(
    storage: KeyValueStorage,
    platform: ResolvedPlatform,
    options: WebCoreAppOptions<T>,
): ColorSchemeService {
    const colorScheme = options.colorScheme;

    return wireColorScheme({
        config: { colorScheme: { default: colorScheme?.defaultPreference ?? 'system' } },
        storage,
        ...(colorScheme?.storageKey === undefined ? {} : { colorSchemeStorageKey: colorScheme.storageKey }),
        ...(colorScheme?.themeColors === undefined ? {} : { themeColors: colorScheme.themeColors }),
        targetWindow: platform.targetWindow,
        targetDocument: platform.targetDocument,
    });
}

/**
 * Wire internationalisation and install the locale switcher.
 */
function resolveLocale<T extends FoundationConfig>(
    settings: Readonly<T>,
    modules: readonly ModuleDefinition[],
    storage: KeyValueStorage,
    platform: ResolvedPlatform,
    options: WebCoreAppOptions<T>,
): Promise<WiredLocale> {
    const i18n = options.i18n;

    return wireLocale({
        config: settings,
        modules,
        ...(i18n?.sharedLoaders === undefined ? {} : { sharedLoaders: i18n.sharedLoaders }),
        ...(i18n?.formats === undefined ? {} : { formats: i18n.formats }),
        ...(i18n?.localeStorageKey === undefined ? {} : { localeStorageKey: i18n.localeStorageKey }),
        ...(i18n?.duplicateNamespaceStrategy === undefined
            ? {}
            : { duplicateNamespaceStrategy: i18n.duplicateNamespaceStrategy }),
        storage,
        localeCandidates: options.platform?.localeCandidates ?? [...platform.targetWindow.navigator.languages],
        targetDocument: platform.targetDocument,
    });
}

/**
 * Build and install the opt-in realtime connection, unconnected; null when none
 * is configured.
 */
function resolveRealtime<T extends FoundationConfig>(
    settings: Readonly<T>,
    factory: ((settings: Readonly<T>) => RealtimeConnection) | undefined,
    teardowns: TeardownStack,
): RealtimeConnection | null {
    if (factory === undefined) {
        return null;
    }

    const connection = factory(settings);

    teardowns.push(() => {
        connection.disconnect();
    });

    installRealtime(connection);

    return connection;
}

/**
 * Wire chunk-load-failure recovery onto the router.
 */
function resolveChunkRecovery(
    router: Router,
    storage: KeyValueStorage | null,
    reporter: ErrorReporter,
    clock: () => number,
    tuning: WebCoreChunkRecoveryOptions | undefined,
): (() => void) | null {
    return wireChunkRecovery({
        router,
        storage,
        reporter,
        clock,
        ...(tuning?.enabled === undefined ? {} : { enabled: tuning.enabled }),
        ...(tuning?.reload === undefined ? {} : { reload: tuning.reload }),
        ...(tuning?.windowMs === undefined ? {} : { windowMs: tuning.windowMs }),
    });
}

/**
 * Wire the update and connectivity monitors.
 */
function resolveMonitors<T extends FoundationConfig>(
    settings: Readonly<T>,
    runtimeUrl: string,
    platform: ResolvedPlatform,
    toastService: ToastService,
    monitors: WebCoreMonitorOptions<T> | undefined,
): WiredMonitors {
    return wireMonitors({
        settings,
        runtimeUrl,
        toasts: () => toastService,
        ...(monitors?.updates === undefined ? {} : { updates: monitors.updates }),
        ...(monitors?.connectivity === undefined ? {} : { connectivity: monitors.connectivity }),
        fetchFn: platform.fetchFn,
        targetWindow: platform.targetWindow,
        targetDocument: platform.targetDocument,
    });
}
