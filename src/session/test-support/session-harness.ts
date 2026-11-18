/**
 * Registers the session module through the real registry over a fake window.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { IDBFactory } from 'fake-indexeddb';
import type { Pinia } from 'pinia';
import { createPinia, setActivePinia } from 'pinia';
import { expect } from 'vitest';
import { createApp, defineComponent } from 'vue';
import type { RouteLocationRaw, Router } from 'vue-router';

import { ConfigRepository } from '@sinemacula/foundation/config/config-repository';
import { Environment } from '@sinemacula/foundation/config/environment';
import type { FlagValue } from '@sinemacula/foundation/feature-flags/feature-flags';
import type { HttpClient } from '@sinemacula/foundation/http/http-client';
import type { ModuleHttpContributions } from '@sinemacula/foundation/http/module-http-contributions';
import type { RealtimeConnection } from '@sinemacula/foundation/realtime/realtime-connection';
import type { SessionTokens } from '@sinemacula/foundation/session/session-tokens';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { installAnalytics, installApi, installFeatureFlags, installLogger, installReporting } from '../../app/services';
import { createApplicationI18n } from '../../i18n/application-i18n';
import type { ModuleDefinition, ModuleTeardown, ResolvedPlatform, ScheduleTask } from '../../module/module';
import { scheduleOnTimers } from '../../module/module';
import { registerModules } from '../../module/module-registry';
import { IndexedDbSessionRecordStore } from '../../storage/indexed-db-session-record-store';
import type { SessionStore } from '../session-store';
import { useSessionStore } from '../session-store';
import type { RecordingLockManager } from './session-fixtures';
import { createLockManager, createWebStorage, LINEAGE, SESSION_KEY, snapshot } from './session-fixtures';

/** A window stand-in whose event listeners are dispatched directly. */
export interface FakeWindow {
    /** The in-memory localStorage. */
    readonly localStorage: Storage;

    /** The in-memory IndexedDB. */
    // biome-ignore lint/style/useNamingConvention: mirrors the Window property
    readonly indexedDB: IDBFactory;

    /** A BroadcastChannel delivering to the other channels of this window's bus. */
    readonly BroadcastChannel: typeof BroadcastChannel;

    /** The navigator, with a recording lock manager unless Web Locks is missing. */
    readonly navigator: {
        /** The lock manager, recording each requested name. */
        readonly locks: RecordingLockManager | undefined;
    };

    /** Attach a listener for the given event type. */
    readonly addEventListener: (type: string, listener: (event: StorageEvent) => void) => void;

    /** Detach a listener for the given event type. */
    readonly removeEventListener: (type: string, listener: (event: StorageEvent) => void) => void;

    /** Count the `message` listeners attached to the open channels. */
    readonly listenerCount: () => number;

    /** Count the channels opened and not yet closed. */
    readonly openChannels: () => number;

    /** Announce a session write from another tab, on the default session key's channel. */
    readonly announce: () => void;

    /** Persist a snapshot under the default session key as another tab would, without announcing it; null tokens persist a cleared one. */
    readonly persist: (snapshotTokens: SessionTokens | null, revision?: number, lineage?: string) => Promise<void>;

    /** Store a raw record under the default session key. */
    readonly persistRaw: (record: string) => Promise<void>;

    /** Read the record under the default session key, parsed, or null when none is stored. */
    readonly record: () => Promise<unknown>;

    /** Dispatch a `pageshow` event to the `pageshow` listeners. */
    readonly dispatchPageShow: (persisted: boolean) => void;

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

    /** Whether reading the window IndexedDB throws, as where storage is blocked. */
    readonly indexedDbBlocked?: boolean;

    /** Whether the window lacks IndexedDB. */
    readonly withoutIndexedDb?: boolean;

    /** Whether the window lacks BroadcastChannel. */
    readonly withoutBroadcastChannel?: boolean;
}

/** A channel of a {@link ChannelBus}. */
interface BusChannel {
    /** The channel name. */
    readonly name: string;

    /** The attached `message` listeners. */
    readonly listeners: Set<() => void>;
}

/** The channels of one window and the tabs it simulates. */
interface ChannelBus {
    /** The BroadcastChannel stand-in over the bus. */
    readonly Channel: typeof BroadcastChannel;

    /** Every channel opened and not yet closed. */
    readonly open: Set<BusChannel>;
}

const EmptyComponent = defineComponent({ render: () => null });

/**
 * Build a bus of BroadcastChannel stand-ins, each delivering a message to every
 * other open channel of its name on a later microtask, and throwing once
 * closed.
 */
function createChannelBus(): ChannelBus {
    const open = new Set<BusChannel>();

    /**
     * Open a channel on the bus.
     */
    function Channel(name: string): BroadcastChannel {
        const channel: BusChannel = { name, listeners: new Set() };

        open.add(channel);

        return {
            addEventListener: (type: string, listener: () => void) => {
                if (type === 'message') {
                    channel.listeners.add(listener);
                }
            },
            postMessage: () => {
                if (!open.has(channel)) {
                    throw new DOMException('The channel is closed.', 'InvalidStateError');
                }

                for (const other of open) {
                    if (other !== channel && other.name === name) {
                        queueMicrotask(() => {
                            for (const listener of other.listeners) {
                                listener();
                            }
                        });
                    }
                }
            },
            close: () => {
                open.delete(channel);
            },
        } as unknown as BroadcastChannel;
    }

    return { Channel: Channel as unknown as typeof BroadcastChannel, open };
}

/**
 * Build a window stand-in, optionally without the Web Locks API.
 */
export function createFakeWindow(withoutLocks = false): FakeWindow {
    const listeners = new Map<string, Set<(event: StorageEvent) => void>>();
    const localStorage = createWebStorage();
    const factory = new IDBFactory();
    const bus = createChannelBus();

    /**
     * A handle on the record under the default session key.
     */
    const recordStore = (): IndexedDbSessionRecordStore => new IndexedDbSessionRecordStore(factory, SESSION_KEY);

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
        // biome-ignore lint/style/useNamingConvention: mirrors the Window property
        indexedDB: factory,
        BroadcastChannel: bus.Channel,
        navigator: { locks: withoutLocks ? undefined : createLockManager() },
        addEventListener: (type, listener) => {
            listenersOf(type).add(listener);
        },
        removeEventListener: (type, listener) => {
            listenersOf(type).delete(listener);
        },
        listenerCount: () => [...bus.open].reduce((count, channel) => count + channel.listeners.size, 0),
        openChannels: () => bus.open.size,
        announce: () => {
            const channel = new bus.Channel(SESSION_KEY);

            channel.postMessage(null);
            channel.close();
        },
        persist: (snapshotTokens, revision = 1, lineage = LINEAGE) =>
            recordStore().swap(() => JSON.stringify(snapshot(snapshotTokens, revision, lineage))),
        persistRaw: record => recordStore().swap(() => record),
        record: async () => {
            const record = await recordStore().read();

            return record === null ? null : (JSON.parse(record) as unknown);
        },
        dispatchPageShow: persisted => {
            for (const listener of listenersOf('pageshow')) {
                listener({ persisted } as unknown as StorageEvent);
            }
        },
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
        variant: <Value extends FlagValue>(_key: string, fallback: Value): Value => fallback,
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

    if (setup.indexedDbBlocked === true) {
        Object.defineProperty(win, 'indexedDB', {
            get: () => {
                throw new DOMException('The operation is insecure.', 'SecurityError');
            },
        });
    }

    if (setup.withoutIndexedDb === true) {
        Object.defineProperty(win, 'indexedDB', { value: undefined });
    }

    if (setup.withoutBroadcastChannel === true) {
        Object.defineProperty(win, 'BroadcastChannel', { value: undefined });
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
