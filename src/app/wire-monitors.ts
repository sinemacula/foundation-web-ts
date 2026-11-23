/**
 * Update and connectivity monitor wiring for the bootstrap preset.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { DeepReadonly } from '@sinemacula/foundation/config/config-repository';
import type { ReachabilityProbe } from '@sinemacula/foundation/connectivity/confirmed-connectivity-monitor';
import { createSiteReachabilityProbe } from '../connectivity/site-reachability-probe';
import type { ConnectivityTimings } from '../connectivity/web-connectivity-monitor';
import { WebConnectivityMonitor } from '../connectivity/web-connectivity-monitor';
import { TeardownStack } from '../module/teardown-stack';
import type { ToastService } from '../notifications/toast-service';
import { UpdateMonitor } from '../updates/update-monitor';
import { FoundationBootError } from '@sinemacula/foundation/app/foundation-boot-error';

const DEV_VERSION_SENTINEL = 'dev';

/**
 * The configuration slice the monitor wiring reads.
 */
export interface MonitorWiringSettings {
    /** Application identity carrying the deployed version. */
    readonly app: {
        /** The deployed application version. */
        readonly version: string;
    };
}

/**
 * Update-monitor options accepted by {@link wireMonitors}.
 */
export interface UpdateMonitorWiring<T> {
    /** Whether the update monitor runs. Default: the deployed version is not 'dev'. */
    readonly enabled?: boolean | ((settings: DeepReadonly<T>) => boolean);

    /** The version document location. Defaults to the runtime environment URL. */
    readonly url?: string;

    /** Poll interval in milliseconds. */
    readonly pollIntervalMs?: number;

    /** Application-owned toast key shown sticky (duration 0) on a new version. */
    readonly toastKey?: string;

    /** Full handler for new versions; wins over `toastKey`. */
    readonly onUpdate?: (version: string) => void;
}

/**
 * Connectivity-monitor options accepted by {@link wireMonitors}.
 */
export interface ConnectivityWiring extends ConnectivityTimings {
    /** Whether connectivity monitoring runs. Default: on. */
    readonly enabled?: boolean;

    /** The URL a `HEAD` asks, or a full probe. Defaults to the runtime environment URL. */
    readonly probe?: string | ReachabilityProbe;
}

/**
 * Options for {@link wireMonitors}.
 */
export interface WireMonitorsOptions<T extends MonitorWiringSettings> {
    /** The frozen application configuration. */
    readonly settings: DeepReadonly<T>;

    /** Update-monitor options; omit to take the version-derived defaults. */
    readonly updates?: UpdateMonitorWiring<T>;

    /** The connectivity monitor update polling follows, from {@link createConnectivityMonitor}; omit for none. */
    readonly connectivity?: WebConnectivityMonitor | null;

    /** The runtime environment document URL, the update monitor's default poll target. */
    readonly runtimeUrl: string;

    /** Toast service accessor, read lazily per update rather than at wiring time. */
    readonly toasts: () => ToastService;

    /** The fetch seam used to poll the version document. */
    readonly fetchFn?: typeof fetch;

    /** The document the update monitor watches for visibility. */
    readonly targetDocument?: Document;
}

/**
 * The seams {@link createConnectivityMonitor} builds over.
 */
export interface ConnectivitySeams {
    /** The runtime environment document URL, the default probe target. */
    readonly runtimeUrl: string;

    /** The fetch seam probes go through. */
    readonly fetchFn?: typeof fetch;

    /** The window whose connectivity and page events are observed. */
    readonly targetWindow?: Window;

    /** The document whose visibility gates probing. */
    readonly targetDocument?: Document;
}

/**
 * The wired monitors; either is null when disabled.
 */
export interface WiredMonitors {
    /** The running update monitor, or null when it does not run. */
    readonly updates: UpdateMonitor | null;

    /** The running connectivity monitor, or null when disabled. */
    readonly connectivity: WebConnectivityMonitor | null;

    /** Stops both monitors and detaches their handlers, silencing any update check still in flight; every step runs even when one throws. */
    readonly teardown: () => void;
}

/**
 * A wired monitor, not yet started, and the unsubscribe for its handler.
 */
interface Subscribed<M> {
    /** The wired monitor. */
    readonly monitor: M;

    /** Detaches the handler the wiring subscribed. */
    readonly unsubscribe: () => void;
}

/**
 * Wire the update and connectivity monitors; with connectivity monitoring on,
 * update polling runs only while the site is confirmed reachable.
 *
 * @throws {FoundationBootError} when updates are explicitly enabled with
 * neither a toast key nor an update handler
 */
export function wireMonitors<T extends MonitorWiringSettings>(options: WireMonitorsOptions<T>): WiredMonitors {
    const updates = wireUpdates(options);
    const updateMonitor = updates?.monitor ?? null;
    const connectivity = wireConnectivity(options.connectivity ?? null, updateMonitor);
    const connectivityMonitor = connectivity?.monitor ?? null;

    if (connectivityMonitor?.online ?? true) {
        updateMonitor?.start();
    }

    const teardowns = new TeardownStack();

    for (const subscribed of [updates, connectivity]) {
        if (subscribed !== null) {
            teardowns.push(() => {
                subscribed.monitor.stop();
            });
            teardowns.push(subscribed.unsubscribe);
        }
    }

    return {
        updates: updateMonitor,
        connectivity: connectivityMonitor,
        teardown: () => {
            teardowns.dispose();
        },
    };
}

/**
 * Wire the deployed-version monitor, which stays off without a toast key or
 * handler because the kernel ships no translation keys.
 */
function wireUpdates<T extends MonitorWiringSettings>(
    options: WireMonitorsOptions<T>,
): Subscribed<UpdateMonitor> | null {
    const wiring = options.updates;
    const handler = resolveUpdateHandler(wiring, options.toasts);
    const enabled = resolveUpdatesEnabled(wiring?.enabled, options.settings);

    if (handler === null) {
        if (wiring?.enabled !== undefined && enabled) {
            throw new FoundationBootError(
                'Update monitoring is enabled but cannot surface updates: ' +
                    'provide monitors.updates.toastKey or monitors.updates.onUpdate.',
            );
        }

        return null;
    }

    if (!enabled) {
        return null;
    }

    const monitor = new UpdateMonitor({
        currentVersion: options.settings.app.version,
        url: wiring?.url ?? options.runtimeUrl,
        ...(wiring?.pollIntervalMs === undefined ? {} : { interval: wiring.pollIntervalMs }),
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
        ...(options.targetDocument === undefined ? {} : { targetDocument: options.targetDocument }),
    });

    return { monitor, unsubscribe: monitor.onUpdate(handler) };
}

/**
 * Resolve the new-version handler, or null when the application supplied none.
 */
function resolveUpdateHandler<T>(
    wiring: UpdateMonitorWiring<T> | undefined,
    toasts: () => ToastService,
): ((version: string) => void) | null {
    if (wiring?.onUpdate !== undefined) {
        return wiring.onUpdate;
    }

    const toastKey = wiring?.toastKey;

    if (toastKey === undefined) {
        return null;
    }

    return () => {
        toasts().information(toastKey, { duration: 0 });
    };
}

/**
 * Resolve whether the update monitor runs.
 */
function resolveUpdatesEnabled<T extends MonitorWiringSettings>(
    enabled: boolean | ((settings: DeepReadonly<T>) => boolean) | undefined,
    settings: DeepReadonly<T>,
): boolean {
    if (enabled === undefined) {
        return settings.app.version !== DEV_VERSION_SENTINEL;
    }

    return typeof enabled === 'boolean' ? enabled : enabled(settings);
}

/**
 * Build the connectivity monitor, not yet started, or null when disabled.
 */
export function createConnectivityMonitor(
    wiring: ConnectivityWiring | undefined,
    seams: ConnectivitySeams,
): WebConnectivityMonitor | null {
    const { enabled = true, probe = seams.runtimeUrl, ...timings } = wiring ?? {};

    if (!enabled) {
        return null;
    }

    return new WebConnectivityMonitor({
        ...timings,
        probe:
            typeof probe === 'string'
                ? createSiteReachabilityProbe({
                      url: probe,
                      ...(seams.fetchFn === undefined ? {} : { fetchFn: seams.fetchFn }),
                  })
                : probe,
        ...(seams.targetWindow === undefined ? {} : { targetWindow: seams.targetWindow }),
        ...(seams.targetDocument === undefined ? {} : { targetDocument: seams.targetDocument }),
    });
}

/**
 * Start the connectivity monitor, pausing update polling while offline and
 * checking for a new version as soon as the site is reachable again.
 */
function wireConnectivity(
    monitor: WebConnectivityMonitor | null,
    updates: UpdateMonitor | null,
): Subscribed<WebConnectivityMonitor> | null {
    if (monitor === null) {
        return null;
    }

    const unsubscribe = monitor.onChange(online => {
        if (online) {
            updates?.start();
            void updates?.checkNow();
        } else {
            updates?.stop();
        }
    });

    monitor.start();

    return { monitor, unsubscribe };
}
