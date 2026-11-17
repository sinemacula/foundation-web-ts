/**
 * Integration tests for createWebCoreApp.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Pinia } from 'pinia';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, onMounted, onUnmounted } from 'vue';
import type { RouteRecordRaw, RouterHistory } from 'vue-router';
import { createMemoryHistory, createWebHistory } from 'vue-router';

import type * as PageTracking from '@sinemacula/foundation/analytics/install-page-tracking';
import { NullAnalyticsTracker } from '@sinemacula/foundation/analytics/null-analytics-tracker';
import type { Environment } from '@sinemacula/foundation/config/environment';
import { RuntimeEnvironmentError } from '@sinemacula/foundation/config/runtime-environment-error';
import type { ConnectivityMonitor } from '@sinemacula/foundation/connectivity/connectivity-monitor';
import type { UpdateMonitor } from '../updates/update-monitor';
import { createWebEnvironment } from '../config/web-environment';
import type * as DocumentTitle from '../i18n/document-title';
import { StaticFeatureFlags } from '@sinemacula/foundation/feature-flags/static-feature-flags';
import type { HttpClient, RequestInterceptor, UnauthorizedHandler } from '@sinemacula/foundation/http/http-client';
import { NullLogger } from '@sinemacula/foundation/logging/null-logger';
import type { ModuleBootContext, ModuleDefinition, ModuleRegisterContext, ScheduleTask } from '../module/module';
import { scheduleOnTimers } from '../module/module';
import { ModuleRegistryError } from '../module/module-registry';
import { ConfirmService } from '../notifications/confirm-service';
import { ToastService } from '../notifications/toast-service';
import type { RealtimeConnection } from '@sinemacula/foundation/realtime/realtime-connection';
import { NullErrorReporter } from '@sinemacula/foundation/reporting/null-error-reporter';
import type * as GlobalErrorHandling from '../reporting/install-global-error-handling';
import type * as ChunkErrorRecovery from '../router/chunk-error-recovery';
import type { RouteMiddleware } from '../router/middleware';
import { next } from '@sinemacula/foundation/router/middleware';
import { BrowserStorage } from '../storage/browser-storage';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import type { WebCoreApp, WebCoreAppOptions } from './create-web-core-app';
import { WebCoreAppError, createWebCoreApp, observeBootPhases } from './create-web-core-app';
import {
    analytics,
    api,
    appConfig,
    appStorage,
    colorScheme,
    confirmDialogs,
    featureFlags,
    localeSwitcher,
    logger,
    realtime,
    reporting,
    resetWebCoreServices,
    toasts,
} from './services';
import { FoundationBootError } from '@sinemacula/foundation/app/foundation-boot-error';
import type { WireHttpClientTools } from '@sinemacula/foundation/app/wire-http-client';

/**
 * Hoisted log that the mocked installers below record their teardowns into.
 */
const teardownLog = vi.hoisted(() => {
    const log = { order: null as string[] | null };

    return {
        log,

        /**
         * Wrap an installer so its teardown records the step.
         */
        recorded<A extends unknown[]>(step: string, install: (...args: A) => () => void) {
            return (...args: A): (() => void) => {
                const teardown = install(...args);

                return () => {
                    log.order?.push(step);
                    teardown();
                };
            };
        },
    };
});

vi.mock('../reporting/install-global-error-handling', async importOriginal => {
    const actual = await importOriginal<typeof GlobalErrorHandling>();

    return {
        ...actual,
        installGlobalErrorHandling: teardownLog.recorded('error-handling', actual.installGlobalErrorHandling),
    };
});

vi.mock('@sinemacula/foundation/analytics/install-page-tracking', async importOriginal => {
    const actual = await importOriginal<typeof PageTracking>();

    return { ...actual, installPageTracking: teardownLog.recorded('page-tracking', actual.installPageTracking) };
});

vi.mock('../i18n/document-title', async importOriginal => {
    const actual = await importOriginal<typeof DocumentTitle>();

    return { ...actual, installDocumentTitleSync: teardownLog.recorded('title-sync', actual.installDocumentTitleSync) };
});

vi.mock('../router/chunk-error-recovery', async importOriginal => {
    const actual = await importOriginal<typeof ChunkErrorRecovery>();

    return {
        ...actual,
        installChunkErrorRecovery: teardownLog.recorded('chunk-recovery', actual.installChunkErrorRecovery),
    };
});

const BOOT_PHASE_ORDER = [
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

const EmptyComponent = defineComponent({ render: () => null });

/**
 * Build a string record from pairs, keeping non-camelCase environment keys out
 * of object-literal key positions that the naming rules inspect.
 */
function wire(entries: ReadonlyArray<readonly [string, string]>): Record<string, string> {
    return Object.fromEntries(entries);
}

/**
 * Build a JSON response carrying the given body and status.
 */
function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Build a fetch spy that serves the runtime environment file and delegates
 * every other request to the API responder.
 */
function makeFetch(
    runtime: Record<string, string> | (() => Record<string, string>) = {},
    apiResponder: (url: string, init?: RequestInit) => Response = () => jsonResponse(null),
): ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>> {
    return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
        const url = String(input);

        if (url.endsWith('env.json')) {
            return Promise.resolve(jsonResponse(typeof runtime === 'function' ? runtime() : runtime));
        }

        return Promise.resolve(apiResponder(url, init));
    });
}

type TestWindow = Window & {
    /**
     * Invoke every listener registered for the event type.
     */
    dispatchToListeners(type: string, event: Event): void;

    /**
     * Count the listeners registered for the event type.
     */
    listenerCount(type: string): number;
};

/**
 * Build a map-backed stand-in for a Web Storage area.
 */
function makeWebStorage(): Storage {
    const values = new Map<string, string>();

    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
        removeItem: (key: string) => {
            values.delete(key);
        },
    } as unknown as Storage;
}

/**
 * Build a window stub that records its event listeners, counting media-query
 * listeners under a `media:` prefix.
 */
function makeWindow(languages: readonly string[] = ['en-US'], onLine = true): TestWindow {
    const listeners = new Map<string, EventListenerOrEventListenerObject[]>();

    /**
     * Record a listener under its event type.
     */
    const add = (type: string, listener: EventListenerOrEventListenerObject): void => {
        const existing = listeners.get(type) ?? [];

        existing.push(listener);
        listeners.set(type, existing);
    };

    /**
     * Forget a previously recorded listener.
     */
    const remove = (type: string, listener: EventListenerOrEventListenerObject): void => {
        const existing = listeners.get(type) ?? [];
        const index = existing.indexOf(listener);

        if (index !== -1) {
            existing.splice(index, 1);
        }
    };

    return {
        navigator: { onLine, languages },
        sessionStorage: makeWebStorage(),
        matchMedia: () => ({
            matches: false,
            addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
                add(`media:${type}`, listener);
            },
            removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
                remove(`media:${type}`, listener);
            },
        }),
        addEventListener: add,
        removeEventListener: remove,
        listenerCount(type: string) {
            return (listeners.get(type) ?? []).length;
        },
        dispatchToListeners(type: string, event: Event) {
            for (const listener of listeners.get(type) ?? []) {
                if (typeof listener === 'function') {
                    listener(event);
                } else {
                    listener.handleEvent(event);
                }
            }
        },
    } as unknown as TestWindow;
}

/**
 * Define the configuration tree the tests boot against.
 */
function defineTestConfiguration(environment: Environment) {
    return {
        api: { baseUrl: environment.string('API_URL', 'https://api.test'), timeout: 5_000 },
        app: {
            name: environment.string('APP_NAME', 'Kernel App'),
            environment: environment.string('APP_ENV', 'testing'),
            version: environment.string('APP_VERSION', 'dev'),
        },
        featureFlags: { flags: { beta: true } },
        locales: {
            default: 'en-US',
            enabled: ['en-US', 'fr-FR'],
            supported: {
                'en-US': { direction: 'ltr' as const },
                'fr-FR': { direction: 'ltr' as const },
            },
        },
    };
}

type TestConfiguration = ReturnType<typeof defineTestConfiguration>;

/**
 * Build the config options, optionally pointing at a runtime environment URL.
 */
function makeConfig(runtimeUrl?: string): WebCoreAppOptions<TestConfiguration>['config'] {
    return {
        createEnvironment: (runtime: Readonly<Record<string, string>>): Environment =>
            createWebEnvironment({ runtime, dev: true }),
        define: defineTestConfiguration,
        ...(runtimeUrl === undefined ? {} : { runtimeUrl }),
    };
}

interface Seams {
    /** The fetch spy serving the environment file and API calls. */
    readonly fetchFn: ReturnType<typeof makeFetch>;

    /** The in-memory storage backing the app. */
    readonly storage: MemoryStorage;

    /** The window stub the app attaches listeners to. */
    readonly targetWindow: TestWindow;

    /** The detached document the app writes to. */
    readonly targetDocument: Document;

    /** The fixed clock the app reads time from. */
    readonly clock: () => number;

    /** The scheduling seam the app's modules time work with. */
    readonly schedule: ScheduleTask;

    /** The router history the app navigates with. */
    readonly history: RouterHistory;

    /** The browser locales offered for negotiation. */
    readonly localeCandidates: readonly string[];
}

/**
 * Build the platform seams, optionally around a given fetch spy.
 */
function makeSeams(fetchFn: ReturnType<typeof makeFetch> = makeFetch()): Seams {
    return {
        fetchFn,
        storage: new MemoryStorage(),
        targetWindow: makeWindow(),
        targetDocument: document.implementation.createHTMLDocument('t'),
        clock: (): number => 1_000,
        schedule: () => () => undefined,
        history: createMemoryHistory(),
        localeCandidates: ['en-US'],
    };
}

/**
 * Build a root component that records when it mounts.
 */
function makeRoot(events: string[] = []): ReturnType<typeof defineComponent> {
    return defineComponent({
        setup() {
            onMounted(() => {
                events.push('mounted');
            });

            return () => h('div', { class: 'root' }, 'root');
        },
    });
}

/**
 * Build the home module definition with optional overrides.
 */
function homeModule(overrides: Partial<ModuleDefinition> = {}): ModuleDefinition {
    return {
        name: 'home',
        routes: [{ path: '/', name: 'home.index', component: EmptyComponent }],
        ...overrides,
    };
}

/**
 * Build an idle realtime connection that records disconnects.
 */
function makeRealtime(order: string[]): RealtimeConnection {
    return {
        state: 'idle',
        connect() {
            // The preset never connects; applications decide when to.
        },
        disconnect() {
            order.push('realtime.disconnect');
        },
        on: () => () => {
            // No subscriptions are made by these tests.
        },
        onStateChange: () => () => {
            // No subscriptions are made by these tests.
        },
    };
}

/**
 * Push the step into the order whenever the method runs, then run it.
 */
function recordStep<T extends object>(order: string[], step: string, target: T, method: keyof T & string): void {
    const original = (target[method] as () => void).bind(target);

    vi.spyOn(target, method as never).mockImplementation((() => {
        order.push(step);
        original();
    }) as never);
}

/**
 * Build a lazy route whose chunk always fails to load.
 */
function lazyRoute(): RouteRecordRaw {
    return {
        path: '/lazy',
        name: 'home.lazy',
        component: () => Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/lazy.js')),
    };
}

/** A promise paired with the callbacks that settle it. */
interface Deferred<T> {
    /** The promise the callbacks settle. */
    readonly promise: Promise<T>;

    /** Fulfil the promise with a value. */
    readonly resolve: (value: T) => void;
}

/**
 * Create a promise the test settles on demand.
 */
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;

    const promise = new Promise<T>(settle => {
        resolve = settle;
    });

    return { promise, resolve };
}

/**
 * Boot the app with the default test options and any overrides.
 */
function bootApp(
    overrides: Partial<WebCoreAppOptions<TestConfiguration>> = {},
): Promise<WebCoreApp<TestConfiguration>> {
    return createWebCoreApp<TestConfiguration>({
        root: makeRoot(),
        modules: [homeModule()],
        config: makeConfig(),
        platform: makeSeams(),
        ...overrides,
    });
}

describe('createWebCoreApp', () => {
    afterEach(() => {
        resetWebCoreServices();
    });

    describe('boot phases', () => {
        it('runs every boot phase in the designed order', async () => {
            const phases: string[] = [];
            const detach = observeBootPhases(phase => {
                phases.push(phase);
            });

            const app = await bootApp();

            detach();

            expect(phases).toEqual([...BOOT_PHASE_ORDER]);

            app.dispose();
        });

        it('stops recording phases once the observer is detached', async () => {
            const phases: string[] = [];

            observeBootPhases(phase => {
                phases.push(phase);
            })();

            const app = await bootApp();

            expect(phases).toEqual([]);

            app.dispose();
        });
    });

    describe('runtime document and configuration', () => {
        it('fetches the runtime document from the configured url and freezes the defined configuration', async () => {
            const fetchFn = makeFetch(
                wire([
                    ['APP_NAME', 'Runtime App'],
                    ['API_URL', 'https://api.runtime.test'],
                ]),
            );

            const app = await bootApp({ config: makeConfig('/custom-env.json'), platform: makeSeams(fetchFn) });

            expect(fetchFn).toHaveBeenCalledTimes(1);
            expect(fetchFn).toHaveBeenCalledWith('/custom-env.json', {
                cache: 'no-store',
                headers: { accept: 'application/json' },
                signal: expect.any(AbortSignal),
            });
            expect(app.config.app.name).toBe('Runtime App');
            expect(app.config.api.baseUrl).toBe('https://api.runtime.test');
            expect(Object.isFrozen(app.config)).toBe(true);
            expect(Object.isFrozen(app.config.app)).toBe(true);
            expect(appConfig<TestConfiguration>()).toBe(app.config);
            expect(app.services.config.all()).toBe(app.config);

            app.dispose();
        });

        it('boots over an empty runtime document when it is not deployed', async () => {
            const fetchFn = makeFetch();

            fetchFn.mockResolvedValueOnce(jsonResponse(null, 404));

            const app = await bootApp({ platform: makeSeams(fetchFn) });

            expect(app.config.app.name).toBe('Kernel App');

            app.dispose();
        });

        it.each([
            ['an error status', () => Promise.resolve(jsonResponse(null, 500))],
            ['a network failure', () => Promise.reject(new TypeError('offline'))],
        ])('rejects the boot when the runtime document fails with %s', async (_, response) => {
            const fetchFn = makeFetch();

            fetchFn.mockImplementationOnce(response);

            await expect(bootApp({ platform: makeSeams(fetchFn) })).rejects.toBeInstanceOf(RuntimeEnvironmentError);
        });
    });

    describe('service installation', () => {
        it('installs every provided service and exposes the same references on the handle', async () => {
            const toastService = new ToastService();
            const confirmService = new ConfirmService();
            const reporter = new NullErrorReporter();
            const tracker = new NullAnalyticsTracker();
            const logging = new NullLogger();
            const flags = new StaticFeatureFlags({ beta: false });
            const connection = makeRealtime([]);
            const reporterFactory = vi.fn(() => reporter);
            const analyticsFactory = vi.fn(() => tracker);
            const loggerFactory = vi.fn(() => logging);
            const flagsFactory = vi.fn(() => flags);
            const realtimeFactory = vi.fn(() => connection);
            const pinia = createPinia();
            const seams = makeSeams();

            const app = await bootApp({
                pinia,
                observability: { reporter: reporterFactory, analytics: analyticsFactory, logger: loggerFactory },
                featureFlags: flagsFactory,
                realtime: realtimeFactory,
                notifications: { toasts: toastService, confirm: confirmService },
                platform: seams,
            });

            expect(app.pinia).toBe(pinia);
            expect(api()).toBe(app.services.http);
            expect(appStorage()).toBe(seams.storage);
            expect(app.services.storage).toBe(seams.storage);
            expect(toasts()).toBe(toastService);
            expect(app.services.toasts).toBe(toastService);
            expect(confirmDialogs()).toBe(confirmService);
            expect(app.services.confirm).toBe(confirmService);
            expect(reporting()).toBe(reporter);
            expect(app.services.reporting).toBe(reporter);
            expect(analytics()).toBe(tracker);
            expect(app.services.analytics).toBe(tracker);
            expect(logger()).toBe(logging);
            expect(app.services.logger).toBe(logging);
            expect(featureFlags()).toBe(flags);
            expect(app.services.featureFlags).toBe(flags);
            expect(localeSwitcher()).toBe(app.services.localeSwitcher);
            expect(realtime()).toBe(connection);
            expect(app.services.realtime).toBe(connection);
            expect(reporterFactory).toHaveBeenCalledWith(app.config);
            expect(analyticsFactory).toHaveBeenCalledWith(app.config);
            expect(loggerFactory).toHaveBeenCalledWith(app.config);
            expect(flagsFactory).toHaveBeenCalledWith(app.config);
            expect(realtimeFactory).toHaveBeenCalledWith(app.config);

            app.dispose();
        });
    });

    describe('module lifecycle', () => {
        it('registers modules in registry order with the fallback module moved last', async () => {
            const order: string[] = [];
            const contexts: ModuleRegisterContext[] = [];
            const environments: Environment[] = [];
            const pinia = createPinia();
            const seams = makeSeams();
            const fallback = homeModule({
                name: 'errors',
                fallback: true,
                routes: [{ path: '/:pathMatch(.*)*', name: 'errors.notFound', component: EmptyComponent }],
                register: () => {
                    order.push('register:errors');
                },
            });
            const alpha = homeModule({
                name: 'alpha',
                register: context => {
                    order.push('register:alpha');
                    contexts.push(context);
                },
            });

            const app = await bootApp({
                modules: [fallback, alpha],
                pinia,
                config: {
                    createEnvironment: runtime => {
                        const environment = createWebEnvironment({ runtime, dev: true });

                        environments.push(environment);

                        return environment;
                    },
                    define: defineTestConfiguration,
                },
                platform: seams,
            });

            expect(order).toEqual(['register:alpha', 'register:errors']);
            expect(contexts[0]?.config).toBe(app.services.config);
            expect(contexts[0]?.environment).toBe(environments[0]);
            expect(contexts[0]?.storage).toBe(seams.storage);
            expect(contexts[0]?.pinia).toBe(pinia);
            expect(contexts[0]?.platform.fetchFn).toBe(seams.fetchFn);
            expect(contexts[0]?.platform.targetWindow).toBe(seams.targetWindow);
            expect(contexts[0]?.platform.targetDocument).toBe(seams.targetDocument);
            expect(contexts[0]?.platform.clock).toBe(seams.clock);
            expect(contexts[0]?.platform.schedule).toBe(seams.schedule);

            app.dispose();
        });

        it('boots modules with the assembled runtime context', async () => {
            const contexts: ModuleBootContext[] = [];
            const pinia = createPinia();
            const seams = makeSeams();

            const app = await bootApp({
                modules: [
                    homeModule({
                        boot: context => {
                            contexts.push(context);

                            return undefined;
                        },
                    }),
                ],
                pinia,
                platform: seams,
            });

            expect(contexts).toHaveLength(1);
            expect(contexts[0]?.app).toBe(app.app);
            expect(contexts[0]?.router).toBe(app.router);
            expect(contexts[0]?.pinia).toBe(pinia);
            expect(contexts[0]?.i18n).toBe(app.i18n);
            expect(contexts[0]?.http).toBe(app.services.http);
            expect(contexts[0]?.storage).toBe(seams.storage);
            expect(contexts[0]?.config).toBe(app.services.config);
            expect(contexts[0]?.platform.clock).toBe(seams.clock);
            expect(contexts[0]?.realtime).toBeNull();

            app.dispose();
        });

        it('hands the installed realtime connection to the booting modules', async () => {
            const connection = makeRealtime([]);
            const received: Array<RealtimeConnection | null> = [];

            const app = await bootApp({
                modules: [
                    homeModule({
                        boot: context => {
                            received.push(context.realtime);
                            expect(realtime()).toBe(connection);

                            return undefined;
                        },
                    }),
                ],
                realtime: () => connection,
            });

            expect(received).toStrictEqual([connection]);

            app.dispose();
        });

        it('instantiates module store factories with the application pinia', async () => {
            const received: Pinia[] = [];
            const pinia = createPinia();

            const app = await bootApp({
                modules: [
                    homeModule({
                        stores: [
                            instance => {
                                received.push(instance);

                                return {
                                    $dispose() {
                                        // Disposal order is covered separately.
                                    },
                                };
                            },
                        ],
                    }),
                ],
                pinia,
            });

            expect(received).toEqual([pinia]);

            app.dispose();
        });

        it('tears down already-booted modules when a later boot rejects', async () => {
            const order: string[] = [];

            await expect(
                bootApp({
                    modules: [
                        homeModule({
                            name: 'alpha',
                            boot: () => () => {
                                order.push('teardown:alpha');
                            },
                        }),
                        homeModule({
                            name: 'beta',
                            routes: [{ path: '/beta', name: 'beta.index', component: EmptyComponent }],
                            boot: () => {
                                throw new Error('beta boot failed');
                            },
                        }),
                    ],
                }),
            ).rejects.toThrow('beta boot failed');

            expect(order).toEqual(['teardown:alpha']);
        });

        it('rejects module lists that fail registry validation', async () => {
            const boot = bootApp({ modules: [homeModule({ name: 'dupe' }), homeModule({ name: 'dupe' })] });

            await expect(boot).rejects.toBeInstanceOf(ModuleRegistryError);
            await expect(boot).rejects.toThrow('Duplicate module names: "dupe".');
        });
    });

    describe('http wiring', () => {
        it('runs preset interceptors before module-contributed interceptors', async () => {
            let captured: RequestInit | undefined;
            const fetchFn = makeFetch({}, (_url, init) => {
                captured = init;

                return jsonResponse(null);
            });

            /**
             * Tag every request as having passed the preset interceptor.
             */
            const preset: RequestInterceptor = request => ({
                ...request,
                headers: { ...request.headers, 'x-trace': 'preset' },
            });

            const app = await bootApp({
                modules: [
                    homeModule({
                        register: context => {
                            context.http.addRequestInterceptor(request => ({
                                ...request,
                                headers: { ...request.headers, 'x-trace': `${request.headers['x-trace']}+module` },
                            }));
                        },
                    }),
                ],
                http: { interceptors: [preset] },
                platform: makeSeams(fetchFn),
            });

            await api().get('ping');

            expect(captured?.headers).toMatchObject({ 'x-trace': 'preset+module' });

            app.dispose();
        });

        it('routes 401 responses through the module-contributed unauthorized handler', async () => {
            const onUnauthorized = vi.fn<UnauthorizedHandler>(async () => false);
            const fetchFn = makeFetch({}, () => jsonResponse({ message: 'Unauthorized' }, 401));

            const app = await bootApp({
                modules: [
                    homeModule({
                        register: context => {
                            context.http.setUnauthorizedHandler(onUnauthorized);
                        },
                    }),
                ],
                platform: makeSeams(fetchFn),
            });

            await api()
                .get('secure')
                .catch(() => {
                    // The 401 rejection itself is not under test here.
                });

            expect(onUnauthorized).toHaveBeenCalledTimes(1);

            app.dispose();
        });

        it('raises the configured toast and reports unexpected api failures', async () => {
            const toastService = new ToastService();
            const reporter = new NullErrorReporter();
            const captureSpy = vi.spyOn(reporter, 'captureError');
            const fetchFn = makeFetch({}, () => jsonResponse({}, 500));

            const app = await bootApp({
                http: { unexpectedErrorToastKey: 'app.errors.unexpected' },
                notifications: { toasts: toastService },
                observability: { reporter: () => reporter },
                platform: makeSeams(fetchFn),
            });

            await api()
                .get('boom')
                .catch(() => {
                    // The rejection itself is under test in the http suite.
                });

            expect(toastService.toasts.value).toHaveLength(1);
            expect(toastService.toasts.value[0]?.message).toBe('app.errors.unexpected');
            expect(captureSpy).toHaveBeenCalledTimes(1);
            expect(captureSpy.mock.calls[0]?.[1]).toEqual({
                source: 'http',
                method: 'GET',
                url: 'https://api.test/boom',
            });

            app.dispose();
        });

        it('lets an application response-error handler fully replace the default', async () => {
            const onResponseError = vi.fn();
            const toastService = new ToastService();
            const fetchFn = makeFetch({}, () => jsonResponse({}, 500));

            const app = await bootApp({
                http: { onResponseError, unexpectedErrorToastKey: 'app.errors.unexpected' },
                notifications: { toasts: toastService },
                platform: makeSeams(fetchFn),
            });

            await api()
                .get('boom')
                .catch(() => {
                    // The rejection itself is under test in the http suite.
                });

            expect(onResponseError).toHaveBeenCalledTimes(1);
            expect(toastService.toasts.value).toHaveLength(0);

            app.dispose();
        });

        it('installs the client returned by the http client override with the resolved tools', async () => {
            const fake = { get: vi.fn() } as unknown as HttpClient;

            /**
             * Pass the request through as the preset interceptor.
             */
            const preset: RequestInterceptor = request => request;

            /**
             * Pass the request through as the module-contributed interceptor.
             */
            const contributed: RequestInterceptor = request => request;

            const onUnauthorized = vi.fn<UnauthorizedHandler>(async () => false);
            const seams = makeSeams();
            const client = vi.fn((_tools: WireHttpClientTools<TestConfiguration>) => fake);

            const app = await bootApp({
                modules: [
                    homeModule({
                        register: context => {
                            context.http.addRequestInterceptor(contributed);
                            context.http.setUnauthorizedHandler(onUnauthorized);
                        },
                    }),
                ],
                http: { client, interceptors: [preset] },
                platform: seams,
            });

            expect(api()).toBe(fake);
            expect(app.services.http).toBe(fake);
            expect(client).toHaveBeenCalledTimes(1);

            const tools = client.mock.calls[0]?.[0];

            expect(tools?.config).toBe(app.config);
            expect(tools?.fetchFn).toBe(seams.fetchFn);
            expect(tools?.interceptors).toEqual([preset, contributed]);
            expect(tools?.onUnauthorized).toBe(onUnauthorized);
            expect(typeof tools?.onResponseError).toBe('function');

            app.dispose();
        });
    });

    describe('locale wiring', () => {
        it('wires detection, module messages, shared loaders and the switcher through the seams', async () => {
            const seams = makeSeams();

            seams.storage.set('app.locale', 'fr-FR');

            const app = await bootApp({
                modules: [homeModule({ locales: async locale => ({ greeting: `hello-${locale}` }) })],
                i18n: {
                    sharedLoaders: {
                        'en-US': async () => ({ shared: { title: 'Shared' } }),
                        'fr-FR': async () => ({ shared: { title: 'Partage' } }),
                    },
                    formats: { number: { 'fr-FR': { decimal: { style: 'decimal' } } } },
                    localeStorageKey: 'app.locale',
                    duplicateNamespaceStrategy: 'module-wins',
                },
                platform: seams,
            });

            expect(app.i18n.global.locale.value).toBe('fr-FR');
            expect(seams.targetDocument.documentElement.getAttribute('lang')).toBe('fr-FR');
            expect(seams.targetDocument.documentElement.getAttribute('dir')).toBe('ltr');
            expect(app.i18n.global.t('home.greeting')).toBe('hello-fr-FR');
            expect(app.i18n.global.t('shared.title')).toBe('Partage');
            expect(app.i18n.global.getNumberFormat('fr-FR')).toEqual({ decimal: { style: 'decimal' } });
            expect(localeSwitcher().current.value).toBe('fr-FR');

            app.dispose();
        });

        it('detects the locale from the window navigator languages when no candidates are supplied', async () => {
            const seams = makeSeams();
            const platform = {
                fetchFn: seams.fetchFn,
                storage: seams.storage,
                targetWindow: makeWindow(['fr-FR']),
                targetDocument: seams.targetDocument,
                clock: seams.clock,
                history: seams.history,
            };

            const app = await bootApp({ platform });

            expect(app.i18n.global.locale.value).toBe('fr-FR');
            expect(localeSwitcher().current.value).toBe('fr-FR');
            expect(seams.targetDocument.documentElement.getAttribute('lang')).toBe('fr-FR');

            app.dispose();
        });

        it('lets module messages shadow a shared key when the strategy is module-wins', async () => {
            const app = await bootApp({
                modules: [homeModule({ locales: async () => ({ title: 'Module' }) })],
                i18n: {
                    sharedLoaders: { 'en-US': async () => ({ home: { title: 'Shared' } }) },
                    duplicateNamespaceStrategy: 'module-wins',
                },
            });

            expect(app.i18n.global.t('home.title')).toBe('Module');

            app.dispose();
        });

        it('switches to a locale whose first load failed once its translations load again', async () => {
            const failure = new Error('chunk failed');
            let offline = true;

            const app = await bootApp({
                modules: [
                    homeModule({
                        locales: locale => {
                            if (locale === 'fr-FR' && offline) {
                                offline = false;

                                return Promise.reject(failure);
                            }

                            return Promise.resolve({ greeting: `hello-${locale}` });
                        },
                    }),
                ],
            });

            await expect(localeSwitcher().switchTo('fr-FR')).rejects.toBe(failure);

            await localeSwitcher().switchTo('fr-FR');

            expect(app.i18n.global.locale.value).toBe('fr-FR');
            expect(app.i18n.global.t('home.greeting')).toBe('hello-fr-FR');

            app.dispose();
        });
    });

    describe('colour-scheme wiring', () => {
        it('wires the colour-scheme service through the seams and exposes it on the handle', async () => {
            const seams = makeSeams();

            seams.storage.set('theme', 'dark');

            const app = await bootApp({ platform: seams });

            expect(app.services.colorScheme.preference()).toBe('dark');
            expect(app.services.colorScheme.resolved()).toBe('dark');
            expect(colorScheme()).toBe(app.services.colorScheme);
            expect(seams.targetDocument.documentElement.getAttribute('data-theme')).toBe('dark');

            app.dispose();
        });

        it('applies the configured default preference when nothing is stored', async () => {
            const seams = makeSeams();

            const app = await bootApp({ colorScheme: { defaultPreference: 'dark' }, platform: seams });

            expect(app.services.colorScheme.preference()).toBe('dark');
            expect(seams.targetDocument.documentElement.getAttribute('data-theme')).toBe('dark');

            app.dispose();
        });

        it('honours the colour-scheme storage key and theme colours', async () => {
            const seams = makeSeams();

            seams.storage.set('app.theme', 'light');

            const app = await bootApp({
                colorScheme: { storageKey: 'app.theme', themeColors: { light: '#ffffff', dark: '#000000' } },
                platform: seams,
            });

            expect(app.services.colorScheme.preference()).toBe('light');
            expect(seams.targetDocument.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
                '#ffffff',
            );

            app.dispose();
        });

        it('defaults the preference to system when no option or stored value is present', async () => {
            const app = await bootApp();

            expect(app.services.colorScheme.preference()).toBe('system');

            app.dispose();
        });

        it('reports a throwing colour-scheme listener to the installed reporter', async () => {
            const reporter = new NullErrorReporter();
            const captureSpy = vi.spyOn(reporter, 'captureError');
            const failure = new Error('listener failure');
            const app = await bootApp({ observability: { reporter: () => reporter } });

            app.services.colorScheme.subscribe(() => {
                throw failure;
            });
            app.services.colorScheme.setPreference('dark');

            expect(captureSpy).toHaveBeenCalledWith(failure, { source: 'color-scheme' });
            expect(app.services.colorScheme.preference()).toBe('dark');

            app.dispose();
        });

        it('disposes the colour-scheme service on teardown', async () => {
            const app = await bootApp();
            const disposeSpy = vi.spyOn(app.services.colorScheme, 'dispose');

            app.dispose();

            expect(disposeSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('router wiring', () => {
        it('runs module guards on navigation and resolves unknown paths to the fallback module', async () => {
            const guarded: string[] = [];
            const guard: RouteMiddleware = {
                handle: context => {
                    guarded.push(context.to.fullPath);

                    return next();
                },
            };
            const seams = makeSeams();

            const app = await bootApp({
                modules: [
                    homeModule({ guards: [guard] }),
                    homeModule({
                        name: 'errors',
                        fallback: true,
                        routes: [{ path: '/:pathMatch(.*)*', name: 'errors.notFound', component: EmptyComponent }],
                    }),
                ],
                platform: seams,
            });

            await app.router.push('/missing/path');

            expect(app.router.currentRoute.value.name).toBe('errors.notFound');
            expect(guarded).toContain('/missing/path');
            expect(seams.targetDocument.title).toBe('Kernel App');

            app.dispose();
        });
    });

    describe('start', () => {
        it('mounts the root component only after the initial navigation has resolved', async () => {
            const events: string[] = [];
            const guard: RouteMiddleware = {
                handle: () => {
                    events.push('navigation');

                    return next();
                },
            };
            const seams = makeSeams();
            const host = seams.targetDocument.createElement('div');

            seams.targetDocument.body.appendChild(host);

            const app = await bootApp({
                root: makeRoot(events),
                modules: [homeModule({ guards: [guard] })],
                platform: seams,
            });

            await app.start(host);

            expect(events).toEqual(['navigation', 'mounted']);
            expect(host.innerHTML).toContain('root');

            app.dispose();
        });
    });

    describe('monitors', () => {
        it('arms the update monitor against the runtime url and surfaces new versions as sticky toasts', async () => {
            let version = '1.0.0';
            const fetchFn = makeFetch(() => wire([['APP_VERSION', version]]));
            const toastService = new ToastService();

            const app = await bootApp({
                config: makeConfig('/custom-env.json'),
                notifications: { toasts: toastService },
                monitors: { updates: { toastKey: 'app.updates.available', pollIntervalMs: 60_000 } },
                platform: makeSeams(fetchFn),
            });

            expect(app.monitors.updates).not.toBeNull();
            expect(app.monitors.connectivity).not.toBeNull();

            version = '2.0.0';

            await app.monitors.updates?.checkNow();

            expect(fetchFn).toHaveBeenLastCalledWith('/custom-env.json', {
                cache: 'no-store',
                headers: { accept: 'application/json' },
                signal: expect.any(AbortSignal),
            });
            expect(toastService.toasts.value).toHaveLength(1);
            expect(toastService.toasts.value[0]?.message).toBe('app.updates.available');
            expect(toastService.toasts.value[0]?.variant).toBe('information');
            expect(toastService.toasts.value[0]?.duration).toBe(0);

            app.dispose();
        });

        it('rejects with FoundationBootError when update monitoring is enabled with no way to surface updates', async () => {
            const boot = bootApp({ monitors: { updates: { enabled: true } } });

            await expect(boot).rejects.toBeInstanceOf(FoundationBootError);
            await expect(boot).rejects.toThrow(
                'Update monitoring is enabled but cannot surface updates: ' +
                    'provide monitors.updates.toastKey or monitors.updates.onUpdate.',
            );
        });
    });

    describe('chunk recovery', () => {
        /** Build a home module whose `/lazy` route fails to load its chunk. */
        function staleChunkModule(): ModuleDefinition {
            return homeModule({
                routes: [
                    { path: '/', name: 'home.index', component: EmptyComponent },
                    {
                        path: '/lazy',
                        name: 'home.lazy',
                        component: () =>
                            Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/lazy.js')),
                    },
                ],
            });
        }

        it('recovers stale-deploy chunk failures through the injected reload and clock seams', async () => {
            const reload = vi.fn();
            const seams = makeSeams();

            const app = await bootApp({
                modules: [staleChunkModule()],
                monitors: { chunkRecovery: { enabled: true, reload, windowMs: 30_000 } },
                platform: seams,
            });

            await app.router.push('/lazy').catch(() => {
                // The failed navigation rejection is expected.
            });

            expect(reload).toHaveBeenCalledTimes(1);
            expect(reload).toHaveBeenCalledWith('/lazy');
            expect(seams.targetWindow.sessionStorage.getItem('chunk-recovery.reloaded-at')).toBe('1000');
            expect(seams.storage.get('chunk-recovery.reloaded-at')).toBeNull();

            app.dispose();
        });

        it('applies the configured reload-loop window instead of the default', async () => {
            const reload = vi.fn();
            let now = 1_000;
            const seams = { ...makeSeams(), clock: (): number => now };

            const app = await bootApp({
                modules: [staleChunkModule()],
                monitors: { chunkRecovery: { reload, windowMs: 30_000 } },
                platform: seams,
            });

            await app.router.push('/lazy').catch(() => undefined);
            now += 40_000;
            await app.router.push('/lazy').catch(() => undefined);

            expect(reload).toHaveBeenCalledTimes(2);

            app.dispose();
        });

        it('boots and reports chunk failures without reloading when session storage is refused', async () => {
            const reload = vi.fn();
            const reporter = new NullErrorReporter();
            const captureSpy = vi.spyOn(reporter, 'captureError');
            const targetWindow = makeWindow();

            Object.defineProperty(targetWindow, 'sessionStorage', {
                get: () => {
                    throw new DOMException('denied', 'SecurityError');
                },
            });

            const app = await bootApp({
                modules: [staleChunkModule()],
                monitors: { chunkRecovery: { reload } },
                observability: { reporter: () => reporter },
                platform: { ...makeSeams(), targetWindow },
            });

            await app.router.push('/lazy').catch(() => undefined);

            expect(reload).not.toHaveBeenCalled();
            expect(captureSpy).toHaveBeenCalledWith(expect.any(Error), { source: 'router', path: '/lazy' });

            app.dispose();
        });

        it('installs no recovery when it is disabled', async () => {
            const reload = vi.fn();

            const app = await bootApp({
                modules: [staleChunkModule()],
                monitors: { chunkRecovery: { enabled: false, reload }, connectivity: { enabled: true } },
            });

            await app.router.push('/lazy').catch(() => {
                // The failed navigation rejection is expected.
            });

            expect(reload).not.toHaveBeenCalled();
            expect(app.monitors.updates).toBeNull();
            expect(app.monitors.connectivity).not.toBeNull();

            app.dispose();
        });
    });

    describe('error handling and page tracking', () => {
        it('tracks page views and captures window errors until disposal', async () => {
            const reporter = new NullErrorReporter();
            const tracker = new NullAnalyticsTracker();
            const captureSpy = vi.spyOn(reporter, 'captureError');
            const pageSpy = vi.spyOn(tracker, 'page');
            const seams = makeSeams();

            const app = await bootApp({
                modules: [
                    homeModule({
                        routes: [
                            { path: '/', name: 'home.index', component: EmptyComponent },
                            { path: '/other', name: 'home.other', component: EmptyComponent },
                        ],
                    }),
                ],
                observability: { reporter: () => reporter, analytics: () => tracker },
                platform: seams,
            });

            await app.router.isReady();

            expect(pageSpy).toHaveBeenCalledWith('home.index', { path: '/' });

            await app.router.push('/other');

            expect(pageSpy).toHaveBeenCalledWith('home.other', { path: '/other' });

            const failure = new Error('window failure');

            seams.targetWindow.dispatchToListeners('error', new ErrorEvent('error', { error: failure }));

            expect(captureSpy).toHaveBeenCalledWith(failure, expect.objectContaining({ source: 'window' }));

            app.dispose();

            const pageCalls = pageSpy.mock.calls.length;

            seams.targetDocument.title = 'sentinel';

            await app.router.push('/');

            expect(pageSpy.mock.calls.length).toBe(pageCalls);
            expect(seams.targetDocument.title).toBe('sentinel');
            expect(seams.targetWindow.listenerCount('error')).toBe(0);
            expect(seams.targetWindow.listenerCount('unhandledrejection')).toBe(0);
        });
        it('tracks completed navigations by path only', async () => {
            const tracker = new NullAnalyticsTracker();
            const pageSpy = vi.spyOn(tracker, 'page');
            const app = await bootApp({
                modules: [
                    homeModule({
                        routes: [
                            { path: '/', name: 'home.index', component: EmptyComponent },
                            { path: '/other', name: 'home.other', component: EmptyComponent },
                            { path: '/blocked', name: 'home.blocked', component: EmptyComponent },
                        ],
                    }),
                ],
                observability: { analytics: () => tracker },
            });

            await app.router.isReady();
            app.router.beforeEach(to => to.path !== '/blocked');
            await app.router.push('/other?token=secret#section');
            await app.router.push('/other?token=secret#section');
            await app.router.push('/blocked');

            expect(pageSpy.mock.calls).toStrictEqual([
                ['home.index', { path: '/' }],
                ['home.other', { path: '/other' }],
            ]);

            app.dispose();
        });

        it('reports a throwing page tracker without failing the navigation', async () => {
            const reporter = new NullErrorReporter();
            const tracker = new NullAnalyticsTracker();
            const captureSpy = vi.spyOn(reporter, 'captureError');
            const failure = new Error('tracker failure');

            vi.spyOn(tracker, 'page').mockImplementation(() => {
                throw failure;
            });

            const app = await bootApp({
                modules: [
                    homeModule({
                        routes: [
                            { path: '/', name: 'home.index', component: EmptyComponent },
                            { path: '/other', name: 'home.other', component: EmptyComponent },
                        ],
                    }),
                ],
                observability: { reporter: () => reporter, analytics: () => tracker },
            });

            await app.router.isReady();
            await app.router.push('/other');

            expect(app.router.currentRoute.value.path).toBe('/other');
            expect(captureSpy).toHaveBeenCalledWith(failure, { source: 'page-tracking' });

            app.dispose();
        });
    });

    describe('dispose', () => {
        afterEach(() => {
            teardownLog.log.order = null;
        });

        it('disposes everything the boot installed in reverse order', async () => {
            const order: string[] = [];
            const fetchFn = makeFetch(wire([['APP_VERSION', '1.0.0']]));
            const seams = makeSeams(fetchFn);
            const toastService = new ToastService();
            const confirmService = new ConfirmService();
            const host = seams.targetDocument.createElement('div');

            teardownLog.log.order = order;

            const app = await bootApp({
                root: defineComponent({
                    setup() {
                        onUnmounted(() => {
                            order.push('unmount');
                        });

                        return () => h('div', 'root');
                    },
                }),
                notifications: { toasts: toastService, confirm: confirmService },
                modules: [
                    homeModule({
                        name: 'alpha',
                        stores: [
                            () => ({
                                $dispose() {
                                    order.push('dispose:store-1');
                                },
                            }),
                            () => ({
                                $dispose() {
                                    order.push('dispose:store-2');
                                },
                            }),
                        ],
                        boot: () => () => {
                            order.push('teardown:alpha');
                        },
                    }),
                    homeModule({
                        name: 'errors',
                        fallback: true,
                        routes: [{ path: '/:pathMatch(.*)*', name: 'errors.notFound', component: EmptyComponent }],
                        boot: () => () => {
                            order.push('teardown:errors');
                        },
                    }),
                ],
                realtime: () => makeRealtime(order),
                monitors: { updates: { toastKey: 'app.updates.available' } },
                platform: seams,
            });

            await app.start(host);

            recordStep(order, 'updates.stop', app.monitors.updates as UpdateMonitor, 'stop');
            recordStep(order, 'connectivity.stop', app.monitors.connectivity as ConnectivityMonitor, 'stop');
            recordStep(order, 'history.destroy', seams.history, 'destroy');
            recordStep(order, 'toasts.clear', toastService, 'clear');
            recordStep(order, 'confirm.cancelAll', confirmService, 'cancelAll');
            recordStep(order, 'color-scheme', app.services.colorScheme, 'dispose');

            app.dispose();

            expect(order).toEqual([
                'unmount',
                'connectivity.stop',
                'updates.stop',
                'chunk-recovery',
                'teardown:errors',
                'teardown:alpha',
                'realtime.disconnect',
                'page-tracking',
                'error-handling',
                'title-sync',
                'history.destroy',
                'dispose:store-2',
                'dispose:store-1',
                'confirm.cancelAll',
                'toasts.clear',
                'color-scheme',
            ]);
            expect(host.innerHTML).toBe('');

            app.dispose();

            expect(order).toHaveLength(16);
        });

        it('no longer recovers chunk failures once disposed', async () => {
            const reload = vi.fn();

            const app = await bootApp({
                modules: [
                    homeModule({ routes: [{ path: '/', name: 'home.index', component: EmptyComponent }, lazyRoute()] }),
                ],
                monitors: { chunkRecovery: { reload } },
            });

            app.dispose();

            await app.router.push('/lazy').catch(() => {
                // The failed navigation rejection is expected.
            });

            expect(reload).not.toHaveBeenCalled();
        });

        it('runs every teardown when one throws, then rethrows that failure', async () => {
            const failure = new Error('teardown failed');
            const order: string[] = [];
            const seams = makeSeams();

            const app = await bootApp({
                modules: [
                    homeModule({ name: 'alpha', boot: () => () => order.push('teardown:alpha') }),
                    homeModule({
                        name: 'beta',
                        routes: [{ path: '/beta', name: 'beta.index', component: EmptyComponent }],
                        boot: () => () => {
                            throw failure;
                        },
                    }),
                ],
                realtime: () => makeRealtime(order),
                platform: seams,
            });

            expect(() => {
                app.dispose();
            }).toThrow(failure);
            expect(order).toEqual(['teardown:alpha', 'realtime.disconnect']);
            expect(seams.targetWindow.listenerCount('error')).toBe(0);
            expect(seams.targetWindow.listenerCount('unhandledrejection')).toBe(0);
            expect(seams.targetWindow.listenerCount('media:change')).toBe(0);

            expect(() => {
                app.dispose();
            }).not.toThrow();
        });

        it('declines every pending confirmation and clears timed toasts', async () => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

            try {
                const toastService = new ToastService();
                const confirmService = new ConfirmService();
                const app = await bootApp({ notifications: { toasts: toastService, confirm: confirmService } });

                toastService.success('saved');

                const active = confirmService.confirm({ title: 'Delete?', message: 'This cannot be undone.' });
                const queued = confirmService.confirm({ title: 'Archive?', message: 'Move it to the archive.' });

                app.dispose();

                expect(await active).toBe(false);
                expect(await queued).toBe(false);
                expect(toastService.toasts.value).toHaveLength(0);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        });

        it('silences an update check still in flight', async () => {
            const response = deferred<Response>();
            const toastService = new ToastService();
            const fetchFn = makeFetch(wire([['APP_VERSION', '1.0.0']]));

            const app = await bootApp({
                notifications: { toasts: toastService },
                monitors: { updates: { toastKey: 'app.updates.available' } },
                platform: makeSeams(fetchFn),
            });

            fetchFn.mockImplementationOnce(() => response.promise);

            const check = app.monitors.updates?.checkNow();

            app.dispose();
            response.resolve(jsonResponse(wire([['APP_VERSION', '2.0.0']])));
            await check;

            expect(toastService.toasts.value).toHaveLength(0);
        });

        it('leaves service holders installed after dispose until resetWebCoreServices', async () => {
            const app = await bootApp();

            app.dispose();

            expect(() => api()).not.toThrow();
            expect(() => toasts()).not.toThrow();

            resetWebCoreServices();

            expect(() => api()).toThrow('http client accessed before initialisation');
            expect(() => toasts()).toThrow('toast service accessed before initialisation');
        });
    });

    describe('boot rollback', () => {
        const failure = new Error('boot step failed');

        /**
         * Build a module whose store, boot teardown and failures are recorded.
         */
        function recordedModule(order: string[], overrides: Partial<ModuleDefinition> = {}): ModuleDefinition {
            return homeModule({
                name: 'alpha',
                stores: [
                    () => ({
                        $dispose() {
                            order.push('dispose:store');
                        },
                    }),
                ],
                boot: () => () => {
                    order.push('teardown:alpha');
                },
                ...overrides,
            });
        }

        /**
         * Build a module whose boot always rejects with the shared failure.
         */
        function failingModule(): ModuleDefinition {
            return homeModule({
                name: 'beta',
                routes: [{ path: '/beta', name: 'beta.index', component: EmptyComponent }],
                boot: () => Promise.reject(failure),
            });
        }

        /**
         * Assert that nothing the boot attached to the window is left behind.
         */
        function expectWindowReleased(targetWindow: TestWindow): void {
            expect(targetWindow.listenerCount('error')).toBe(0);
            expect(targetWindow.listenerCount('unhandledrejection')).toBe(0);
            expect(targetWindow.listenerCount('media:change')).toBe(0);
            expect(targetWindow.listenerCount('online')).toBe(0);
        }

        it.each<[string, (order: string[]) => Partial<WebCoreAppOptions<TestConfiguration>>, string[]]>([
            [
                'the environment cannot be built',
                order => ({
                    modules: [recordedModule(order)],
                    config: {
                        createEnvironment: () => {
                            throw failure;
                        },
                        define: defineTestConfiguration,
                    },
                }),
                [],
            ],
            [
                'a register hook throws',
                order => ({
                    modules: [
                        recordedModule(order, {
                            register: () => {
                                throw failure;
                            },
                        }),
                    ],
                }),
                [],
            ],
            [
                'a store factory throws',
                order => ({
                    modules: [
                        recordedModule(order),
                        homeModule({
                            name: 'beta',
                            routes: [],
                            stores: [
                                () => {
                                    throw failure;
                                },
                            ],
                        }),
                    ],
                }),
                ['dispose:store'],
            ],
            [
                'a locale loader rejects',
                order => ({ modules: [recordedModule(order, { locales: () => Promise.reject(failure) })] }),
                ['dispose:store'],
            ],
            [
                'a module boot rejects',
                order => ({ modules: [recordedModule(order), failingModule()] }),
                ['teardown:alpha', 'realtime.disconnect', 'dispose:store'],
            ],
        ])('tears down what was installed when %s', async (_label, failingOptions, expected) => {
            const order: string[] = [];
            const seams = makeSeams();

            await expect(
                bootApp({ realtime: () => makeRealtime(order), platform: seams, ...failingOptions(order) }),
            ).rejects.toBe(failure);

            expect(order).toEqual(expected);
            expectWindowReleased(seams.targetWindow);
        });

        it('tears down every booted module when update monitoring is enabled only in production without a handler', async () => {
            const order: string[] = [];
            const seams = makeSeams(makeFetch(wire([['APP_ENV', 'production']])));

            await expect(
                bootApp({
                    modules: [recordedModule(order)],
                    realtime: () => makeRealtime(order),
                    monitors: { updates: { enabled: settings => settings.app.environment === 'production' } },
                    platform: seams,
                }),
            ).rejects.toBeInstanceOf(FoundationBootError);

            expect(order).toEqual(['teardown:alpha', 'realtime.disconnect', 'dispose:store']);
            expectWindowReleased(seams.targetWindow);
        });

        it('reports teardown failures and still rejects with the boot error', async () => {
            const teardownFailure = new Error('teardown failed');
            const reporter = new NullErrorReporter();
            const capture = vi.spyOn(reporter, 'captureError');
            const seams = makeSeams();

            await expect(
                bootApp({
                    modules: [
                        homeModule({
                            name: 'alpha',
                            boot: () => () => {
                                throw teardownFailure;
                            },
                        }),
                        failingModule(),
                    ],
                    observability: { reporter: () => reporter },
                    platform: seams,
                }),
            ).rejects.toBe(failure);

            expect(capture).toHaveBeenCalledTimes(1);
            expect(capture).toHaveBeenCalledWith(teardownFailure, { source: 'boot-rollback' });
            expectWindowReleased(seams.targetWindow);
        });

        it('releases the default browser history when the routes cannot be compiled', async () => {
            const adds = vi.spyOn(window, 'addEventListener');
            const removes = vi.spyOn(window, 'removeEventListener');
            const seams = makeSeams();

            try {
                await expect(
                    bootApp({
                        modules: [homeModule({ routes: [{ path: '/:id(\\d+', component: EmptyComponent }] })],
                        platform: {
                            fetchFn: seams.fetchFn,
                            storage: seams.storage,
                            targetWindow: seams.targetWindow,
                            targetDocument: seams.targetDocument,
                            localeCandidates: seams.localeCandidates,
                        },
                    }),
                ).rejects.toThrow();

                expect(adds.mock.calls.map(([type]) => type)).toContain('popstate');
                expect(removes.mock.calls.map(([type]) => type).sort()).toEqual(
                    adds.mock.calls.map(([type]) => type).sort(),
                );
            } finally {
                adds.mockRestore();
                removes.mockRestore();
            }
        });

        it('declines a confirmation a module opened before the boot failed', async () => {
            const confirmService = new ConfirmService();
            const opened: Array<Promise<boolean>> = [];

            await expect(
                bootApp({
                    modules: [
                        homeModule({
                            name: 'alpha',
                            boot: () => {
                                opened.push(
                                    confirmService.confirm({
                                        title: 'Resume?',
                                        message: 'Pick up where you left off.',
                                    }),
                                );

                                return undefined;
                            },
                        }),
                        failingModule(),
                    ],
                    notifications: { confirm: confirmService },
                }),
            ).rejects.toBe(failure);

            expect(opened).toHaveLength(1);
            expect(await opened[0]).toBe(false);
        });

        it('keeps the boot error when the reporter itself throws', async () => {
            const reporter = new NullErrorReporter();

            vi.spyOn(reporter, 'captureError').mockImplementation(() => {
                throw new Error('reporter failed');
            });

            await expect(
                bootApp({
                    modules: [
                        homeModule({
                            name: 'alpha',
                            boot: () => () => {
                                throw new Error('teardown failed');
                            },
                        }),
                        failingModule(),
                    ],
                    observability: { reporter: () => reporter },
                }),
            ).rejects.toBe(failure);
        });

        it('boots cleanly on the same window after a failed boot', async () => {
            const seams = makeSeams();

            await expect(bootApp({ modules: [homeModule(), failingModule()], platform: seams })).rejects.toBe(failure);

            resetWebCoreServices();

            const app = await bootApp({ platform: { ...seams, history: createMemoryHistory() } });

            expect(seams.targetWindow.listenerCount('error')).toBe(1);
            expect(seams.targetWindow.listenerCount('media:change')).toBe(1);

            app.dispose();

            expectWindowReleased(seams.targetWindow);
        });
    });

    describe('handle lifecycle', () => {
        it('unmounts the root on dispose', async () => {
            const events: string[] = [];
            const seams = makeSeams();
            const host = seams.targetDocument.createElement('div');
            const app = await bootApp({
                root: defineComponent({
                    setup() {
                        onUnmounted(() => {
                            events.push('unmounted');
                        });

                        return () => h('div', 'root');
                    },
                }),
                platform: seams,
            });

            await app.start(host);
            app.dispose();

            expect(events).toEqual(['unmounted']);
            expect(host.innerHTML).toBe('');
        });

        it('rejects and never mounts when disposed while the initial navigation is pending', async () => {
            const gate = deferred<undefined>();
            const seams = makeSeams();
            const host = seams.targetDocument.createElement('div');
            const app = await bootApp({
                modules: [
                    homeModule({
                        guards: [
                            {
                                handle: async () => {
                                    await gate.promise;

                                    return next();
                                },
                            },
                        ],
                    }),
                ],
                platform: seams,
            });

            const starting = app.start(host);

            app.dispose();

            await expect(starting).rejects.toThrow('The application has been disposed.');

            gate.resolve(undefined);
            await app.router.isReady().catch(() => undefined);

            expect(host.innerHTML).toBe('');
        });

        it('rejects and leaves nothing mounted when a component disposes the handle while mounting', async () => {
            const seams = makeSeams();
            const host = seams.targetDocument.createElement('div');
            let mounting: WebCoreApp<TestConfiguration> | null = null;

            const app = await bootApp({
                root: defineComponent({
                    setup() {
                        onMounted(() => {
                            mounting?.dispose();
                        });

                        return () => h('div', 'root');
                    },
                }),
                platform: seams,
            });

            mounting = app;

            await expect(app.start(host)).rejects.toThrow('The application has been disposed.');
            expect(host.innerHTML).toBe('');
        });

        it('drops a navigation still waiting on a guard when disposed', async () => {
            const gate = deferred<undefined>();
            const app = await bootApp({
                modules: [
                    homeModule({
                        routes: [
                            { path: '/', name: 'home.index', component: EmptyComponent },
                            { path: '/other', name: 'home.other', component: EmptyComponent },
                        ],
                        guards: [
                            {
                                handle: async context => {
                                    if (context.to.path === '/other') {
                                        await gate.promise;
                                    }

                                    return next();
                                },
                            },
                        ],
                    }),
                ],
            });

            await app.router.isReady();

            const navigating = app.router.push('/other');

            app.dispose();
            gate.resolve(undefined);
            await navigating;

            expect(app.router.currentRoute.value.path).toBe('/');
        });

        it('rejects a start after dispose', async () => {
            const app = await bootApp();

            app.dispose();

            const starting = app.start(document.createElement('div'));

            await expect(starting).rejects.toBeInstanceOf(WebCoreAppError);
            await expect(starting).rejects.toThrow('The application has been disposed.');
            await expect(starting).rejects.toHaveProperty('name', 'WebCoreAppError');
        });

        it('reports disposal rather than a repeat start once a started handle is disposed', async () => {
            const seams = makeSeams();
            const app = await bootApp({ platform: seams });

            await app.start(seams.targetDocument.createElement('div'));
            app.dispose();

            await expect(app.start(seams.targetDocument.createElement('div'))).rejects.toThrow(
                'The application has been disposed.',
            );
        });

        it('waits for a pending initial navigation before mounting', async () => {
            const gate = deferred<undefined>();
            const seams = makeSeams();
            const host = seams.targetDocument.createElement('div');
            const app = await bootApp({
                modules: [
                    homeModule({
                        guards: [
                            {
                                handle: async () => {
                                    await gate.promise;

                                    return next();
                                },
                            },
                        ],
                    }),
                ],
                platform: seams,
            });

            const starting = app.start(host);

            await new Promise(resolve => {
                setTimeout(resolve, 0);
            });

            expect(host.innerHTML).toBe('');

            gate.resolve(undefined);
            await starting;

            expect(host.innerHTML).toContain('root');

            app.dispose();
        });

        it('rejects a second start and keeps the first mount', async () => {
            const seams = makeSeams();
            const host = seams.targetDocument.createElement('div');
            const app = await bootApp({ platform: seams });

            await app.start(host);

            await expect(app.start(host)).rejects.toThrow('The application has already been started.');
            expect(host.querySelectorAll('.root')).toHaveLength(1);

            app.dispose();
        });

        it('disposes without unmounting when the mount target was missing', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

            try {
                const app = await bootApp();

                await app.start('#missing-mount-target');
                app.dispose();

                expect(warn.mock.calls.flat().join(' ')).not.toContain('Cannot unmount');
            } finally {
                warn.mockRestore();
            }
        });

        it('returns listeners, timers and the mounted root to baseline across repeated boots', async () => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

            const globalAdds = vi.spyOn(window, 'addEventListener');
            const globalRemoves = vi.spyOn(window, 'removeEventListener');
            const documentAdds = vi.spyOn(document, 'addEventListener');
            const documentRemoves = vi.spyOn(document, 'removeEventListener');
            const seams = makeSeams(makeFetch(wire([['APP_VERSION', '1.0.0']])));
            const targetAdds = vi.spyOn(seams.targetDocument, 'addEventListener');
            const targetRemoves = vi.spyOn(seams.targetDocument, 'removeEventListener');
            const host = seams.targetDocument.createElement('div');
            const events: string[] = [];

            try {
                for (let cycle = 0; cycle < 20; cycle += 1) {
                    const app = await bootApp({
                        root: makeRoot(events),
                        realtime: () => makeRealtime([]),
                        monitors: { updates: { toastKey: 'app.updates.available' } },
                        platform: { ...seams, history: createWebHistory() },
                    });

                    await app.start(host);

                    expect(vi.getTimerCount()).toBeGreaterThan(0);

                    app.dispose();
                    resetWebCoreServices();

                    expect(host.innerHTML).toBe('');
                    expect(vi.getTimerCount()).toBe(0);
                }

                expect(events).toHaveLength(20);
                expect(globalRemoves.mock.calls.length).toBe(globalAdds.mock.calls.length);
                expect(documentRemoves.mock.calls.length).toBe(documentAdds.mock.calls.length);
                expect(targetRemoves.mock.calls.length).toBe(targetAdds.mock.calls.length);

                for (const type of ['error', 'unhandledrejection', 'online', 'offline', 'media:change']) {
                    expect(seams.targetWindow.listenerCount(type)).toBe(0);
                }
            } finally {
                vi.restoreAllMocks();
                vi.useRealTimers();
            }
        });
    });

    describe('storage', () => {
        it('falls back to in-memory storage when the browser blocks local storage', async () => {
            const seams = makeSeams();

            Object.defineProperty(seams.targetWindow, 'localStorage', {
                get: () => {
                    throw new DOMException('Access is denied for this document.', 'SecurityError');
                },
            });

            const app = await bootApp({
                platform: {
                    fetchFn: seams.fetchFn,
                    targetWindow: seams.targetWindow,
                    targetDocument: seams.targetDocument,
                    history: seams.history,
                    localeCandidates: seams.localeCandidates,
                },
            });

            expect(app.services.storage).toBeInstanceOf(MemoryStorage);
            expect(appStorage()).toBe(app.services.storage);

            app.dispose();
        });
    });

    describe('connectivity', () => {
        it('holds update polling while booted offline until the window comes back online', async () => {
            vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

            try {
                const seams = {
                    ...makeSeams(makeFetch(wire([['APP_VERSION', '1.0.0']]))),
                    targetWindow: makeWindow(['en-US'], false),
                };
                const app = await bootApp({
                    monitors: { updates: { toastKey: 'app.updates.available' } },
                    platform: seams,
                });

                expect(vi.getTimerCount()).toBe(0);

                seams.targetWindow.dispatchToListeners('online', new Event('online'));

                expect(vi.getTimerCount()).toBe(1);

                seams.targetWindow.dispatchToListeners('offline', new Event('offline'));

                expect(vi.getTimerCount()).toBe(0);

                app.dispose();
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('service holders', () => {
        it('leaves no realtime connection for a replacement application booted after a reset', async () => {
            const first = await bootApp({ realtime: () => makeRealtime([]) });

            first.dispose();
            resetWebCoreServices();

            const second = await bootApp();

            expect(() => realtime()).toThrow('realtime connection accessed before initialisation');

            second.dispose();
        });
    });

    describe('platform defaults', () => {
        it('boots on the global platform when no seams are provided', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn(async () => jsonResponse(wire([['APP_NAME', 'Default App']]))),
            );

            document.body.innerHTML = '<div id="app"></div>';

            try {
                const clockValues: number[] = [];
                const schedules: ScheduleTask[] = [];

                const app = await createWebCoreApp<TestConfiguration>({
                    root: makeRoot(),
                    modules: [
                        homeModule({
                            boot: context => {
                                clockValues.push(context.platform.clock());
                                schedules.push(context.platform.schedule);

                                return undefined;
                            },
                        }),
                    ],
                    config: makeConfig(),
                });

                expect(globalThis.fetch).toHaveBeenCalledWith('/runtime-env.json', {
                    cache: 'no-store',
                    headers: { accept: 'application/json' },
                    signal: expect.any(AbortSignal),
                });
                expect(app.config.app.name).toBe('Default App');
                expect(appStorage()).toBeInstanceOf(BrowserStorage);
                expect(toasts()).toBeInstanceOf(ToastService);
                expect(confirmDialogs()).toBeInstanceOf(ConfirmService);
                expect(reporting()).toBeInstanceOf(NullErrorReporter);
                expect(analytics()).toBeInstanceOf(NullAnalyticsTracker);
                expect(logger()).toBeInstanceOf(NullLogger);
                expect(featureFlags()).toBeInstanceOf(StaticFeatureFlags);
                expect(featureFlags().isEnabled('beta')).toBe(true);
                expect(app.monitors.updates).toBeNull();
                expect(app.monitors.connectivity).toBeNull();
                expect(app.services.realtime).toBeNull();
                expect(() => realtime()).toThrow('realtime connection accessed before initialisation');
                expect(clockValues).toHaveLength(1);
                expect(clockValues[0]).toBeGreaterThan(0);
                expect(clockValues[0]).toBeLessThanOrEqual(Date.now());
                expect(schedules).toStrictEqual([scheduleOnTimers]);

                await app.start();

                expect(document.querySelector('#app')?.innerHTML).toContain('root');

                app.dispose();
            } finally {
                vi.unstubAllGlobals();
                document.body.innerHTML = '';
            }
        });
    });
});
