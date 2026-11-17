/**
 * Registers the session module through the real registry over a fake window.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Pinia } from 'pinia';
import { createPinia, setActivePinia } from 'pinia';
import { expect } from 'vitest';
import { createApp, defineComponent } from 'vue';
import type { RouteLocationRaw, Router } from 'vue-router';

import { ConfigRepository } from '@sinemacula/foundation/config/config-repository';
import { Environment } from '@sinemacula/foundation/config/environment';
import type { HttpClient } from '@sinemacula/foundation/http/http-client';
import type { ModuleHttpContributions } from '@sinemacula/foundation/http/module-http-contributions';
import type { RealtimeConnection } from '@sinemacula/foundation/realtime/realtime-connection';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { installAnalytics, installApi, installFeatureFlags, installLogger, installReporting } from '../../app/services';
import { createApplicationI18n } from '../../i18n/application-i18n';
import type { ModuleDefinition, ModuleTeardown, ResolvedPlatform, ScheduleTask } from '../../module/module';
import { scheduleOnTimers } from '../../module/module';
import { registerModules } from '../../module/module-registry';
import type { SessionStore } from '../session-store';
import { useSessionStore } from '../session-store';
import type { RecordingLockManager } from './session-fixtures';
import { createLockManager, createWebStorage } from './session-fixtures';

/** A window stand-in whose event listeners are dispatched directly. */
export interface FakeWindow {
    /** The in-memory localStorage. */
    readonly localStorage: Storage;

    /** The navigator, with a recording lock manager unless Web Locks is missing. */
    readonly navigator: {
        /** The lock manager, recording each requested name. */
        readonly locks: RecordingLockManager | undefined;
    };

    /** Attach a listener for the given event type. */
    readonly addEventListener: (type: string, listener: (event: StorageEvent) => void) => void;

    /** Detach a listener for the given event type. */
    readonly removeEventListener: (type: string, listener: (event: StorageEvent) => void) => void;

    /** Count the attached `storage` listeners. */
    readonly listenerCount: () => number;

    /** Dispatch a `storage` event to the `storage` listeners, from the localStorage unless another area is given. */
    readonly dispatchStorage: (init: {
        /** The changed key, or null for a clear. */
        key: string | null;

        /** The changed storage area. */
        storageArea?: Storage;
    }) => void;
}

/** Recording stand-ins for the observability holders. */
export interface Observability {
    /** Every captured error. */
    readonly errors: unknown[];

    /** Every reporter identity set, null for a clear. */
    readonly reportedUsers: unknown[];

    /** Every analytics identity. */
    readonly identified: string[];

    /** One entry per analytics reset. */
    readonly resets: number[];

    /** Every analytics identify and reset, in order. */
    readonly analyticsCalls: string[];

    /** Every feature-flag evaluation context. */
    readonly flagContexts: unknown[];

    /** Every logged warning message. */
    readonly warnings: string[];
}

/** Everything a test needs around the registered module. */
export interface SessionHarness {
    /** The registered module. */
    readonly module: ModuleDefinition;

    /** The application pinia. */
    readonly pinia: Pinia;

    /** The best-effort application storage. */
    readonly appStorage: MemoryStorage;

    /** The target window. */
    readonly win: FakeWindow;

    /** The resolved platform seams. */
    readonly platform: ResolvedPlatform;

    /** The module's HTTP contributions. */
    readonly contributions: ModuleHttpContributions;

    /** Every route the router was pushed to. */
    readonly pushes: RouteLocationRaw[];

    /** The observability recordings. */
    readonly observability: Observability;

    /** Resolve the session store over the application pinia. */
    readonly store: () => SessionStore;

    /** Run the module's stores phase. */
    readonly stores: () => void;

    /** Run the module's boot phase. */
    readonly boot: () => Promise<ModuleTeardown>;
}

/** Seams the harness is built over. */
export interface HarnessSetup {
    /** The platform clock. Default always 0. */
    readonly clock?: () => number;

    /** The platform scheduling seam. Default the global timers. */
    readonly schedule?: ScheduleTask;

    /** The current route's path. Default '/dashboard'. */
    readonly fullPath?: string;

    /** The error every navigation rejects with. */
    readonly pushRejection?: Error;

    /** The realtime connection handed to the boot phase. */
    readonly realtime?: RealtimeConnection | null;

    /** Whether the Web Locks API is missing. */
    readonly withoutLocks?: boolean;

    /** Whether reading the window localStorage throws, as where storage is blocked. */
    readonly storageBlocked?: boolean;
}

const EmptyComponent = defineComponent({ render: () => null });

/**
 * Build a window stand-in, optionally without the Web Locks API.
 */
export function createFakeWindow(withoutLocks = false): FakeWindow {
    const listeners = new Map<string, Set<(event: StorageEvent) => void>>();
    const localStorage = createWebStorage();

    /**
     * The listeners attached for the given event type.
     */
    const listenersOf = (type: string): Set<(event: StorageEvent) => void> => {
        const attached = listeners.get(type) ?? new Set();

        listeners.set(type, attached);

        return attached;
    };

    return {
        localStorage,
        navigator: { locks: withoutLocks ? undefined : createLockManager() },
        addEventListener: (type, listener) => {
            listenersOf(type).add(listener);
        },
        removeEventListener: (type, listener) => {
            listenersOf(type).delete(listener);
        },
        listenerCount: () => listenersOf('storage').size,
        dispatchStorage: init => {
            const event = { key: init.key, storageArea: init.storageArea ?? localStorage } as StorageEvent;

            for (const listener of listenersOf('storage')) {
                listener(event);
            }
        },
    };
}

/**
 * Build an HTTP client stand-in that fails loudly if called.
 */
export function createHttpClientStub(): HttpClient {
    /** Reject an unexpected request. */
    const fail = (): Promise<never> => Promise.reject(new Error('The stub HTTP client must not be called.'));

    return { get: fail, post: fail, put: fail, patch: fail, delete: fail, download: fail };
}

/**
 * Install recording observability holders and a stub HTTP client.
 */
export function installObservability(): Observability {
    const observability: Observability = {
        errors: [],
        reportedUsers: [],
        identified: [],
        resets: [],
        analyticsCalls: [],
        flagContexts: [],
        warnings: [],
    };

    installApi(createHttpClientStub());
    installLogger({
        debug: () => undefined,
        info: () => undefined,
        warn: message => {
            observability.warnings.push(message);
        },
        error: () => undefined,
    });
    installReporting({
        captureError: error => {
            observability.errors.push(error);
        },
        captureMessage: () => undefined,
        setUser: reported => {
            observability.reportedUsers.push(reported);
        },
    });
    installAnalytics({
        track: () => undefined,
        page: () => undefined,
        identify: id => {
            observability.identified.push(id);
            observability.analyticsCalls.push(`identify ${id}`);
        },
        reset: () => {
            observability.resets.push(1);
            observability.analyticsCalls.push('reset');
        },
    });
    installFeatureFlags({
        isEnabled: () => false,
        variant: (_key, fallback) => fallback,
        setContext: context => {
            observability.flagContexts.push(context);
        },
        onChange: () => () => undefined,
    });

    return observability;
}

/**
 * Register the module and assemble the stores and boot phases around it.
 */
export function createSessionHarness(module: ModuleDefinition, setup: HarnessSetup = {}): SessionHarness {
    const observability = installObservability();
    const pinia = createPinia();

    setActivePinia(pinia);

    const appStorage = new MemoryStorage();
    const win = createFakeWindow(setup.withoutLocks);

    if (setup.storageBlocked === true) {
        Object.defineProperty(win, 'localStorage', {
            get: () => {
                throw new DOMException('The operation is insecure.', 'SecurityError');
            },
        });
    }
    const platform: ResolvedPlatform = {
        fetchFn: () => Promise.resolve(new Response()),
        targetWindow: win as unknown as Window,
        targetDocument: document,
        clock: setup.clock ?? (() => 0),
        schedule: setup.schedule ?? scheduleOnTimers,
    };
    const contributions = registerModules([module], {
        config: new ConfigRepository({}),
        environment: new Environment({ get: () => undefined }),
        storage: appStorage,
        pinia,
        platform,
    });
    const pushes: RouteLocationRaw[] = [];
    const router = {
        currentRoute: { value: { fullPath: setup.fullPath ?? '/dashboard' } },
        push: (to: RouteLocationRaw): Promise<void> => {
            pushes.push(to);

            return setup.pushRejection === undefined ? Promise.resolve() : Promise.reject(setup.pushRejection);
        },
    } as unknown as Router;

    return {
        module,
        pinia,
        appStorage,
        win,
        platform,
        contributions,
        pushes,
        observability,
        store: () => useSessionStore(pinia),
        stores: () => {
            for (const factory of module.stores ?? []) {
                factory(pinia);
            }
        },
        boot: async () => {
            const teardown = await module.boot?.({
                app: createApp(EmptyComponent),
                router,
                pinia,
                i18n: createApplicationI18n('en-GB'),
                http: createHttpClientStub(),
                storage: appStorage,
                config: new ConfigRepository({}),
                platform,
                realtime: setup.realtime ?? null,
            });

            expect(teardown).toBeTypeOf('function');

            return teardown as ModuleTeardown;
        },
    };
}
