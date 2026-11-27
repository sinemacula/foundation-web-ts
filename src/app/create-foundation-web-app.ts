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
import type { ConfigRepository, DeepReadonly } from '@sinemacula/foundation/config/config-repository';
import type { Environment } from '@sinemacula/foundation/config/environment';
import { RUNTIME_ENVIRONMENT_URL } from '../config/runtime-environment';
import type { ConnectivityHintSink } from '@sinemacula/foundation/connectivity/confirmed-connectivity-monitor';
import type { ConnectivityMonitor } from '@sinemacula/foundation/connectivity/connectivity-monitor';
import type { FeatureFlags } from '@sinemacula/foundation/feature-flags/feature-flags';
import type {
    HttpClient,
    RequestInterceptor,
    ResponseErrorHandler,
    TransportObserver,
} from '@sinemacula/foundation/http/http-client';
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
import { installGlobalErrorHandling } from '../reporting/install-global-error-handling';
import { tabRecoveryStorage } from '../router/chunk-error-recovery';
import { BrowserStorage } from '../storage/browser-storage';
import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import type { ColorSchemePreference } from '@sinemacula/foundation/theme/color-scheme';
import type { ColorSchemeService } from '@sinemacula/foundation/theme/color-scheme-service';
import type { UpdateMonitor } from '../updates/update-monitor';
import { BootFailureReporter, createBootFailureReference } from './boot-failure';
import { installRealtime, reporting } from './services';
import { bootFoundationCore } from '@sinemacula/foundation/app/boot-foundation-core';
import type { FoundationConfig } from '@sinemacula/foundation/app/foundation-config';
import { wireChunkRecovery } from './wire-chunk-recovery';
import { wireColorScheme } from './wire-color-scheme';
import type { WireHttpClientTools } from '@sinemacula/foundation/app/wire-http-client';
import type { WiredLocale } from './wire-locale';
import { wireLocale } from './wire-locale';
import { CONNECTIVITY_MONITOR } from '../composables/use-connectivity';
import { COOKIE_SUPPORT } from '../composables/use-cookies-accepted';
import type { ConnectivityWiring, UpdateMonitorWiring, WiredMonitors } from './wire-monitors';
import { createConnectivityMonitor, wireMonitors } from './wire-monitors';
import type { WebConnectivityMonitor } from '../connectivity/web-connectivity-monitor';
import { CookieSupport } from '../cookies/cookie-support';
import type { WiredObservability } from '@sinemacula/foundation/app/wire-observability';
import { wireRouter } from './wire-router';

const DEFAULT_MOUNT_SELECTOR = '#app';
const DISPOSED_MESSAGE = 'The application has been disposed.';
const ALREADY_STARTED_MESSAGE = 'The application has already been started.';
const BOOT_FAILED_MESSAGE = 'The application failed to boot.';

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
export class FoundationWebAppError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FoundationWebAppError';
    }
}

/**
 * The application failed to boot. The original failure is the `cause`.
 */
export class FoundationWebBootError extends Error {
    /** The reference the failure was reported under, or null when it was not reported under one. */
    readonly reference: string | null;

    constructor(cause: unknown, reference: string | null) {
        super(cause instanceof Error ? cause.message : BOOT_FAILED_MESSAGE, { cause });
        this.name = 'FoundationWebBootError';
        this.reference = reference;
    }
}

/**
 * Configuration construction options.
 */
export interface FoundationWebConfigOptions<T extends FoundationConfig> {
    /** Builds the environment from the fetched runtime document; the only place build-time variables may appear. Throw to abort boot. Pair with `createWebEnvironment` for the standard dev-chain and production required-keys behaviour. */
    readonly createEnvironment: (runtime: Readonly<Record<string, string>>) => Environment;

    /** Configuration definition over the environment; the result is deep-frozen. */
    readonly define: (environment: Environment) => T;

    /** The runtime-environment URL, also the update monitor's default poll target. Default '/runtime-env.json'. A 404 boots over an empty document; any other failure, or no document within 5 seconds, rejects the boot. */
    readonly runtimeUrl?: string;
}

/**
 * HTTP client construction options.
 */
export interface FoundationWebHttpOptions<T extends FoundationConfig> {
    /** Preset-level interceptors; module contributions are appended after these. */
    readonly interceptors?: readonly RequestInterceptor[];

    /** Full replacement of the preset response-error handler. */
    readonly onResponseError?: ResponseErrorHandler;

    /** Arms the default handler's toast; the kernel ships no translation keys. */
    readonly unexpectedErrorToastKey?: string;

    /** Told of every attempt's transport outcome, after the connectivity monitor. */
    readonly onTransport?: TransportObserver;

    /** Full adapter override; receives the resolved construction inputs. */
    readonly client?: (tools: WireHttpClientTools<T>) => HttpClient;
}

/**
 * Internationalisation options.
 */
export interface FoundationWebI18nOptions {
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
}

/**
 * Colour-scheme options.
 */
export interface FoundationWebColorSchemeOptions {
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
export interface FoundationWebObservabilityOptions<T extends FoundationConfig> {
    /** Error-reporter factory; wins over the environment default. */
    readonly reporter?: (settings: DeepReadonly<T>) => ErrorReporter;

    /** Analytics-tracker factory; wins over the environment default. */
    readonly analytics?: (settings: DeepReadonly<T>) => AnalyticsTracker;

    /** Logger factory; wins over the environment default. */
    readonly logger?: (settings: DeepReadonly<T>) => Logger;

    /** Generates the reference a boot failure is reported under. Default a random `XXXX-XXXX`. */
    readonly reference?: () => string;
}

/**
 * State-only notification services; rendering hosts stay application-side.
 */
export interface FoundationWebNotificationOptions {
    /** Replacement toast service; defaults to a fresh state-only service. */
    readonly toasts?: ToastService;

    /** Replacement confirm service; defaults to a fresh state-only service. */
    readonly confirm?: ConfirmService;
}

/**
 * Chunk-load-failure recovery tuning.
 */
export interface FoundationWebChunkRecoveryOptions {
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
export interface FoundationWebMonitorOptions<T extends FoundationConfig> {
    /** Update-monitor options; omit to take the version-derived defaults. */
    readonly updates?: UpdateMonitorWiring<T>;

    /** Confirmed connectivity monitoring, on by default and fed by the HTTP client. */
    readonly connectivity?: ConnectivityWiring;

    /** Chunk-load-failure recovery tuning. */
    readonly chunkRecovery?: FoundationWebChunkRecoveryOptions;
}

/**
 * Platform seams threaded to every subsystem that accepts them.
 */
export interface FoundationWebPlatformOptions {
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
 * Options accepted by {@link createFoundationWebApp}.
 */
export interface FoundationWebAppOptions<T extends FoundationConfig> {
    /** Root component mounted by {@link FoundationWebApp.start}. */
    readonly root: Component;

    /** Explicit ordered module list, validated by the module registry. */
    readonly modules: readonly ModuleDefinition[];

    /** Injectable for tests; defaults to a fresh pinia instance. */
    readonly pinia?: Pinia;

    /** Configuration construction options. */
    readonly config: FoundationWebConfigOptions<T>;

    /** HTTP client construction options. */
    readonly http?: FoundationWebHttpOptions<T>;

    /** Internationalisation options. */
    readonly i18n?: FoundationWebI18nOptions;

    /** Colour-scheme options. */
    readonly colorScheme?: FoundationWebColorSchemeOptions;

    /** Observability adapter factories. */
    readonly observability?: FoundationWebObservabilityOptions<T>;

    /** Feature-flag provider factory; defaults to the config-driven static adapter. */
    readonly featureFlags?: (settings: DeepReadonly<T>) => FeatureFlags;

    /** Opt-in realtime connection, installed before the modules boot, handed to them unconnected and disconnected on dispose. */
    readonly realtime?: (settings: DeepReadonly<T>) => RealtimeConnection;

    /** State-only notification services. */
    readonly notifications?: FoundationWebNotificationOptions;

    /** Release monitoring options. */
    readonly monitors?: FoundationWebMonitorOptions<T>;

    /** Platform seams threaded to every subsystem. */
    readonly platform?: FoundationWebPlatformOptions;
}

/**
 * Direct typed references to every service the preset installed.
 */
export interface FoundationWebServices<T extends object> {
    /** The application configuration repository. */
    readonly config: ConfigRepository<T>;

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

    /** Whether the browser keeps cookies, checked once at boot. */
    readonly cookieSupport: CookieSupport;

    /** The realtime connection, or null when none was installed. */
    readonly realtime: RealtimeConnection | null;
}

/**
 * The assembled application handle returned by {@link createFoundationWebApp}.
 */
export interface FoundationWebApp<T extends FoundationConfig> {
    /** The Vue application instance. */
    readonly app: App<Element>;

    /** The application router. */
    readonly router: Router;

    /** The Pinia instance backing the stores. */
    readonly pinia: Pinia;

    /** The i18n instance. */
    readonly i18n: ApplicationI18n;

    /** The frozen configuration tree. */
    readonly config: DeepReadonly<T>;

    /** Direct typed references to every service the preset installed. */
    readonly services: FoundationWebServices<T>;

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
     * @throws {FoundationWebAppError} when the handle was already started, or is
     * disposed before it mounts
     */
    start(selector?: string | Element): Promise<void>;

    /**
     * Idempotently unmount the application and tear down everything the boot
     * installed, in reverse order, including the router history. Every step
     * runs even when an earlier one throws. Service holders stay installed;
     * call `resetFoundationWebServices` before booting a replacement
     * application.
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
    readonly repository: ConfigRepository<T>;

    /** The frozen configuration tree. */
    readonly settings: DeepReadonly<T>;

    /** The installed storage adapter. */
    readonly storage: KeyValueStorage;

    /** The installed colour-scheme service. */
    readonly colorScheme: ColorSchemeService;

    /** Whether the browser keeps cookies, provided to components. */
    readonly cookieSupport: CookieSupport;

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
 * Error sinks the foundation phases feed before the boot completes.
 */
interface BootSinks {
    /** Receives colour-scheme errors, held until a reporter is wired. */
    readonly onColorSchemeError: (error: unknown) => void;

    /** Receives the reporter as soon as the core has wired it. */
    readonly onReporter: (reporter: ErrorReporter) => void;

    /** Receives each request attempt's transport outcome. */
    readonly onTransport: (reachable: boolean) => void;
}

/**
 * Boot a web application through the kernel's phase sequence. A failed boot is
 * reported with `source: 'boot'` once a reporter is wired, then tears down
 * everything it installed; service holders it installed stay installed.
 *
 * @throws {FoundationWebBootError} wrapping the original failure, such as a
 * ModuleRegistryError for an invalid module list, a RuntimeEnvironmentError
 * when the runtime document cannot be loaded (only a 404 boots over an empty
 * document), or a FoundationBootError when the monitor options cannot work
 */
export async function createFoundationWebApp<T extends FoundationConfig>(
    options: FoundationWebAppOptions<T>,
): Promise<FoundationWebApp<T>> {
    const platform = resolvePlatform(options.platform);
    const runtimeUrl = options.config.runtimeUrl ?? RUNTIME_ENVIRONMENT_URL;
    const teardowns = new TeardownStack();

    const colorSchemeErrors = new DeferredErrorSink('color-scheme');
    const bootFailures = new BootFailureReporter(options.observability?.reference ?? createBootFailureReference);
    const transportHints = new LateHintSink();

    try {
        const foundation = await bootFoundation(
            options,
            platform,
            runtimeUrl,
            {
                onColorSchemeError: colorSchemeErrors.report,
                onReporter: bootFailures.attach,
                onTransport: transportHints.hint,
            },
            teardowns,
        );

        colorSchemeErrors.attach(foundation.observability.reporter);

        const connectivity = startConnectivity(options, platform, runtimeUrl, foundation, teardowns);

        transportHints.attach(connectivity);

        const moduleLayer = await bootModuleLayer(options, platform, foundation, teardowns);
        const integration = await wireAppIntegration(options, platform, foundation, moduleLayer, teardowns);
        const monitors = wireReleaseMonitors(
            options,
            platform,
            runtimeUrl,
            foundation,
            integration,
            connectivity,
            teardowns,
        );

        return assembleApp(foundation, moduleLayer, integration, monitors, teardowns);
    } catch (error) {
        throw new FoundationWebBootError(
            error,
            bootFailures.report(error, () => teardowns.drain()),
        );
    }
}

/**
 * Forwards transport hints to the connectivity monitor once the boot has wired
 * one.
 */
class LateHintSink {
    /** The wired monitor, or null until then. */
    #target: ConnectivityHintSink | null = null;

    /**
     * Forward a hint, dropping it while no monitor is wired.
     */
    readonly hint = (reachable: boolean): void => {
        this.#target?.hint(reachable);
    };

    /**
     * Forward later hints to the wired monitor, if any.
     */
    attach(target: ConnectivityHintSink | null): void {
        this.#target = target;
    }
}

/**
 * Holds errors raised before the reporter is wired, then forwards them and
 * every later one to it.
 */
class DeferredErrorSink {
    /** The reporter context's source tag. */
    readonly #source: string;

    /** The errors raised before a reporter was attached. */
    readonly #pending: unknown[] = [];

    /** The attached reporter, or null until the boot wires one. */
    #reporter: ErrorReporter | null = null;

    constructor(source: string) {
        this.#source = source;
    }

    /**
     * Forward an error to the reporter, or hold it until one is attached.
     */
    readonly report = (error: unknown): void => {
        if (this.#reporter === null) {
            this.#pending.push(error);

            return;
        }

        this.#reporter.captureError(error, { source: this.#source });
    };

    /**
     * Attach the reporter and flush the held errors to it; a throwing reporter
     * never fails the boot.
     */
    attach(reporter: ErrorReporter): void {
        this.#reporter = reporter;

        for (const error of this.#pending.splice(0)) {
            try {
                this.report(error);
            } catch {
                // Reporting is best-effort; the boot carries on.
            }
        }
    }
}

/**
 * Run the web-owned head phases, then the foundation core, bridging module
 * registration through its contributions callback so pinia and the registry
 * never cross the foundation boundary.
 */
async function bootFoundation<T extends FoundationConfig>(
    options: FoundationWebAppOptions<T>,
    platform: ResolvedPlatform,
    runtimeUrl: string,
    sinks: BootSinks,
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
    const colorScheme = resolveColorScheme(storage, platform, options, sinks.onColorSchemeError);

    teardowns.push(() => {
        colorScheme.dispose();
    });

    const cookieSupport = provideCookieSupport(app, platform.targetWindow);
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
            runtime: { url: runtimeUrl },
            createEnvironment: options.config.createEnvironment,
            define: options.config.define,
            storage,
            toasts: toastService,
            confirm: confirmService,
            ...(options.featureFlags === undefined ? {} : { featureFlags: options.featureFlags }),
            ...(options.observability === undefined ? {} : { observability: options.observability }),
            http: withTransportHints(options.http, sinks.onTransport),
            collectHttpContributions: ({ config, environment }) => {
                // The core wires the reporter immediately before registration.
                sinks.onReporter(reporting());

                recordPhase('register-modules');

                return registerModules(registry.modules, { config, environment, storage, pinia, platform });
            },
            onPhase: recordPhase,
        },
        { fetchFn: platform.fetchFn },
    );

    return { ...core, storage, colorScheme, cookieSupport, registry, app, pinia, toastService, confirmService };
}

/**
 * Route every request attempt's transport outcome to the connectivity monitor
 * first, then to the application's own observer.
 */
function withTransportHints<T extends FoundationConfig>(
    http: FoundationWebHttpOptions<T> | undefined,
    hint: (reachable: boolean) => void,
): FoundationWebHttpOptions<T> {
    return {
        ...http,
        onTransport: (reachable, request) => {
            hint(reachable);
            http?.onTransport?.(reachable, request);
        },
    };
}

/**
 * Run the module phases: instantiate eager stores and wire i18n.
 */
async function bootModuleLayer<T extends FoundationConfig>(
    options: FoundationWebAppOptions<T>,
    platform: ResolvedPlatform,
    foundation: AppFoundation<T>,
    teardowns: TeardownStack,
): Promise<ModuleLayer> {
    const { registry, app, pinia } = foundation;

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

    const { i18n, switcher } = await resolveLocale(foundation, platform, options);

    app.use(i18n);

    return { i18n, switcher };
}

/**
 * Run the app-integration phases: router, error handling, page tracking,
 * realtime and module boot.
 */
async function wireAppIntegration<T extends FoundationConfig>(
    options: FoundationWebAppOptions<T>,
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
    teardowns.push(resolvePageTracking(router, observability));

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
 * Build, provide and start the connectivity monitor ahead of the module phases,
 * so eager stores can read it and failing requests hint it.
 */
function startConnectivity<T extends FoundationConfig>(
    options: FoundationWebAppOptions<T>,
    platform: ResolvedPlatform,
    runtimeUrl: string,
    foundation: AppFoundation<T>,
    teardowns: TeardownStack,
): WebConnectivityMonitor | null {
    const monitor = createConnectivityMonitor(options.monitors?.connectivity, {
        runtimeUrl,
        fetchFn: platform.fetchFn,
        targetWindow: platform.targetWindow,
        targetDocument: platform.targetDocument,
    });

    if (monitor !== null) {
        teardowns.push(() => {
            monitor.stop();
        });
        foundation.app.provide(CONNECTIVITY_MONITOR, monitor);
        monitor.start();
    }

    return monitor;
}

/**
 * Run the release phases: chunk-load recovery and the release monitors.
 */
function wireReleaseMonitors<T extends FoundationConfig>(
    options: FoundationWebAppOptions<T>,
    platform: ResolvedPlatform,
    runtimeUrl: string,
    foundation: AppFoundation<T>,
    integration: AppIntegration,
    connectivity: WebConnectivityMonitor | null,
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

    const monitors = resolveMonitors(
        settings,
        runtimeUrl,
        platform,
        toastService,
        options.monitors?.updates,
        connectivity,
    );

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
): FoundationWebServices<T> {
    const { repository, storage, colorScheme, cookieSupport, toastService, confirmService, observability, flags } =
        foundation;

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
        cookieSupport,
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
): FoundationWebApp<T> {
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
                throw new FoundationWebAppError(DISPOSED_MESSAGE);
            }

            if (started) {
                throw new FoundationWebAppError(ALREADY_STARTED_MESSAGE);
            }

            started = true;

            await Promise.race([router.isReady(), whenAborted(disposal.signal)]);

            if (disposal.signal.aborted) {
                throw new FoundationWebAppError(DISPOSED_MESSAGE);
            }

            teardowns.push(() => {
                unmountIfMounted(app);
            });

            app.mount(selector);

            // A component may dispose the handle while it mounts.
            if (disposal.signal.aborted) {
                unmountIfMounted(app);

                throw new FoundationWebAppError(DISPOSED_MESSAGE);
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
function resolvePlatform(platform: FoundationWebPlatformOptions | undefined): ResolvedPlatform {
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
    options: FoundationWebAppOptions<T>,
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
 * Check whether the window keeps cookies and provide the result to components.
 */
function provideCookieSupport(app: App<Element>, targetWindow: Window): CookieSupport {
    const cookieSupport = new CookieSupport({ targetWindow });

    app.provide(COOKIE_SUPPORT, cookieSupport);

    return cookieSupport;
}

/**
 * Wire and install the colour-scheme service.
 */
function resolveColorScheme<T extends FoundationConfig>(
    storage: KeyValueStorage,
    platform: ResolvedPlatform,
    options: FoundationWebAppOptions<T>,
    onError: (error: unknown) => void,
): ColorSchemeService {
    const colorScheme = options.colorScheme;

    return wireColorScheme({
        config: { colorScheme: { default: colorScheme?.defaultPreference ?? 'system' } },
        storage,
        ...(colorScheme?.storageKey === undefined ? {} : { colorSchemeStorageKey: colorScheme.storageKey }),
        ...(colorScheme?.themeColors === undefined ? {} : { themeColors: colorScheme.themeColors }),
        targetWindow: platform.targetWindow,
        targetDocument: platform.targetDocument,
        onError,
    });
}

/**
 * Wire internationalisation and install the locale switcher, reporting a
 * fallback locale whose messages fail to load.
 */
function resolveLocale<T extends FoundationConfig>(
    foundation: AppFoundation<T>,
    platform: ResolvedPlatform,
    options: FoundationWebAppOptions<T>,
): Promise<WiredLocale> {
    const { settings, registry, storage, observability } = foundation;
    const i18n = options.i18n;

    return wireLocale({
        config: settings,
        modules: registry.modules,
        ...(i18n?.sharedLoaders === undefined ? {} : { sharedLoaders: i18n.sharedLoaders }),
        ...(i18n?.formats === undefined ? {} : { formats: i18n.formats }),
        ...(i18n?.localeStorageKey === undefined ? {} : { localeStorageKey: i18n.localeStorageKey }),
        ...(i18n?.duplicateNamespaceStrategy === undefined
            ? {}
            : { duplicateNamespaceStrategy: i18n.duplicateNamespaceStrategy }),
        ...(i18n?.loadFallbackMessages === undefined ? {} : { loadFallbackMessages: i18n.loadFallbackMessages }),
        onFallbackError: (error, locale) => {
            observability.reporter.captureError(error, { source: 'i18n-fallback', locale });
        },
        storage,
        localeCandidates: options.platform?.localeCandidates ?? [...platform.targetWindow.navigator.languages],
        targetDocument: platform.targetDocument,
    });
}

/**
 * Track page views and navigation breadcrumbs, reporting a throwing tracker or
 * trail.
 */
function resolvePageTracking(router: Router, observability: WiredObservability): () => void {
    return installPageTracking({
        router,
        tracker: observability.analytics,
        trail: observability.trail,
        onError: error => {
            observability.reporter.captureError(error, { source: 'page-tracking' });
        },
    });
}

/**
 * Build and install the opt-in realtime connection, unconnected; null when none
 * is configured.
 */
function resolveRealtime<T extends FoundationConfig>(
    settings: DeepReadonly<T>,
    factory: ((settings: DeepReadonly<T>) => RealtimeConnection) | undefined,
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
    tuning: FoundationWebChunkRecoveryOptions | undefined,
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
    settings: DeepReadonly<T>,
    runtimeUrl: string,
    platform: ResolvedPlatform,
    toastService: ToastService,
    updates: UpdateMonitorWiring<T> | undefined,
    connectivity: WebConnectivityMonitor | null,
): WiredMonitors {
    return wireMonitors({
        settings,
        runtimeUrl,
        toasts: () => toastService,
        ...(updates === undefined ? {} : { updates }),
        connectivity,
        fetchFn: platform.fetchFn,
        targetDocument: platform.targetDocument,
    });
}
