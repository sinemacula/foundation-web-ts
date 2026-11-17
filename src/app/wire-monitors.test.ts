/**
 * Unit tests for wire-monitors.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it, vi } from 'vitest';

import type { ConnectivityMonitor } from '@sinemacula/foundation/connectivity/connectivity-monitor';
import { ToastService } from '../notifications/toast-service';
import type { UpdateMonitor } from '../updates/update-monitor';
import { FoundationBootError } from '@sinemacula/foundation/app/foundation-boot-error';
import type { MonitorWiringSettings, WireMonitorsOptions } from './wire-monitors';
import { wireMonitors } from './wire-monitors';

const THROW_MESSAGE =
    'Update monitoring is enabled but cannot surface updates: ' +
    'provide monitors.updates.toastKey or monitors.updates.onUpdate.';

/**
 * Build a string record from pairs, keeping non-camelCase environment keys out
 * of object-literal key positions that the naming rules inspect.
 */
function wire(entries: ReadonlyArray<readonly [string, string]>): Record<string, string> {
    return Object.fromEntries(entries);
}

/** Build a version-endpoint response reporting the given version. */
function versionResponse(version: string): Response {
    return new Response(JSON.stringify(wire([['APP_VERSION', version]])), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

/** Build a fetch spy that always answers with the given deployed version. */
function makeFetch(version: string) {
    return vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
        versionResponse(version),
    );
}

/** Build a window stand-in that reports the given connectivity and receives dispatched events. */
function makeWindow(onLine = true): Window {
    return Object.assign(new EventTarget(), { navigator: { onLine } }) as unknown as Window;
}

/** Build a detached document that reports itself visible. */
function makeVisibleDocument(): Document {
    const target = document.implementation.createHTMLDocument('t');

    Object.defineProperty(target, 'visibilityState', { value: 'visible' });

    return target;
}

interface Harness {
    /** The settings passed to the wiring. */
    readonly settings: MonitorWiringSettings;

    /** The toast service the monitors notify through. */
    readonly service: ToastService;

    /** Resolve the toast service. */
    readonly toasts: () => ToastService;

    /** The fetch spy used to poll the deployed version. */
    readonly fetchFn: ReturnType<typeof makeFetch>;

    /** The options passed to the wiring. */
    readonly options: WireMonitorsOptions<MonitorWiringSettings>;
}

/** Build the wiring options and collaborators shared by the monitor tests. */
function makeHarness(
    overrides: Partial<WireMonitorsOptions<MonitorWiringSettings>> = {},
    deployedVersion = '2.0.0',
): Harness {
    const settings: MonitorWiringSettings = { app: { version: '1.0.0' } };
    const service = new ToastService();
    const toasts = vi.fn(() => service);
    const fetchFn = makeFetch(deployedVersion);
    const options: WireMonitorsOptions<MonitorWiringSettings> = {
        settings,
        runtimeUrl: '/runtime-env.json',
        toasts,
        fetchFn,
        targetWindow: makeWindow(),
        targetDocument: document.implementation.createHTMLDocument('t'),
        ...overrides,
    };

    return { settings, service, toasts, fetchFn, options };
}

describe('wireMonitors update monitoring', () => {
    it('stays off when neither a toast key nor an update handler is provided', () => {
        const { options } = makeHarness();

        const { updates, connectivity } = wireMonitors(options);

        expect(updates).toBeNull();
        expect(connectivity).toBeNull();
    });

    it('stays off for the dev version sentinel', () => {
        const { options } = makeHarness({
            settings: { app: { version: 'dev' } },
            updates: { toastKey: 'app.updates.available' },
        });

        const { updates, connectivity } = wireMonitors(options);

        expect(updates).toBeNull();
        expect(connectivity).toBeNull();
    });

    it('arms with a toast key on release builds and raises a sticky toast on a new version', async () => {
        const { options, service, toasts } = makeHarness({ updates: { toastKey: 'app.updates.available' } });

        const { updates, connectivity } = wireMonitors(options);

        expect(updates).not.toBeNull();
        expect(toasts).not.toHaveBeenCalled();

        await updates?.checkNow();

        expect(toasts).toHaveBeenCalledTimes(1);
        expect(service.toasts.value).toHaveLength(1);
        expect(service.toasts.value[0]?.message).toBe('app.updates.available');
        expect(service.toasts.value[0]?.variant).toBe('information');
        expect(service.toasts.value[0]?.duration).toBe(0);

        updates?.stop();
        connectivity?.stop();
    });

    it('prefers the onUpdate handler over the toast key', async () => {
        const onUpdate = vi.fn();
        const { options, service, toasts } = makeHarness({
            updates: { toastKey: 'app.updates.available', onUpdate },
        });

        const { updates, connectivity } = wireMonitors(options);

        await updates?.checkNow();

        expect(onUpdate).toHaveBeenCalledWith('2.0.0');
        expect(toasts).not.toHaveBeenCalled();
        expect(service.toasts.value).toHaveLength(0);

        updates?.stop();
        connectivity?.stop();
    });

    it('polls the runtime environment url by default', async () => {
        const { options, fetchFn } = makeHarness({ updates: { toastKey: 'app.updates.available' } });

        const { updates, connectivity } = wireMonitors(options);

        await updates?.checkNow();

        expect(fetchFn).toHaveBeenCalledWith('/runtime-env.json', {
            cache: 'no-store',
            headers: { accept: 'application/json' },
            signal: expect.any(AbortSignal),
        });

        updates?.stop();
        connectivity?.stop();
    });

    it('polls the configured url instead of the runtime default', async () => {
        const { options, fetchFn } = makeHarness({
            updates: { toastKey: 'app.updates.available', url: '/version.json' },
        });

        const { updates, connectivity } = wireMonitors(options);

        await updates?.checkNow();

        expect(fetchFn).toHaveBeenCalledWith('/version.json', {
            cache: 'no-store',
            headers: { accept: 'application/json' },
            signal: expect.any(AbortSignal),
        });

        updates?.stop();
        connectivity?.stop();
    });

    it('starts polling on the configured interval', async () => {
        vi.useFakeTimers();

        try {
            const { options, fetchFn } = makeHarness({
                updates: { toastKey: 'app.updates.available', pollIntervalMs: 1_000 },
            });

            const { updates, connectivity } = wireMonitors(options);

            expect(fetchFn).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(999);

            expect(fetchFn).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);

            expect(fetchFn).toHaveBeenCalledTimes(1);

            updates?.stop();
            connectivity?.stop();
        } finally {
            vi.useRealTimers();
        }
    });

    it('arms when enabled is explicitly true despite the dev sentinel', () => {
        const { options } = makeHarness({
            settings: { app: { version: 'dev' } },
            updates: { enabled: true, toastKey: 'app.updates.available' },
        });

        const { updates, connectivity } = wireMonitors(options);

        expect(updates).not.toBeNull();

        updates?.stop();
        connectivity?.stop();
    });

    it('passes the frozen settings to an enabled predicate', () => {
        const enabled = vi.fn((settings: Readonly<MonitorWiringSettings>) => settings.app.version === '1.0.0');
        const { options, settings } = makeHarness({ updates: { enabled, toastKey: 'app.updates.available' } });

        const { updates, connectivity } = wireMonitors(options);

        expect(updates).not.toBeNull();
        expect(enabled).toHaveBeenCalledTimes(1);
        expect(enabled.mock.calls[0]?.[0]).toBe(settings);

        updates?.stop();
        connectivity?.stop();
    });

    it.each([
        ['explicitly false', false],
        ['a predicate returning false', () => false],
    ])('stays off when enabled is %s', (_label, enabled) => {
        const { options } = makeHarness({ updates: { enabled, toastKey: 'app.updates.available' } });

        const { updates } = wireMonitors(options);

        expect(updates).toBeNull();
    });

    it.each([
        ['explicitly true', true],
        ['a predicate returning true', () => true],
    ])('throws when enabled is %s with no way to surface updates', (_label, enabled) => {
        const { options } = makeHarness({ updates: { enabled } });

        expect(() => wireMonitors(options)).toThrowError(FoundationBootError);
        expect(() => wireMonitors(options)).toThrow(THROW_MESSAGE);
    });

    it('names the error FoundationBootError', () => {
        const { options } = makeHarness({ updates: { enabled: true } });

        try {
            wireMonitors(options);
            expect.unreachable('wireMonitors must throw');
        } catch (error) {
            expect((error as Error).name).toBe('FoundationBootError');
        }
    });

    it('does not throw when an enabled predicate returns false with no way to surface updates', () => {
        const { options } = makeHarness({ updates: { enabled: () => false } });

        const { updates, connectivity } = wireMonitors(options);

        expect(updates).toBeNull();
        expect(connectivity).toBeNull();
    });

    it('checks for a new version when the injected document becomes visible', () => {
        const targetDocument = makeVisibleDocument();
        const { options, fetchFn } = makeHarness({ updates: { toastKey: 'app.updates.available' }, targetDocument });

        const { teardown } = wireMonitors(options);

        document.dispatchEvent(new Event('visibilitychange'));

        expect(fetchFn).not.toHaveBeenCalled();

        targetDocument.dispatchEvent(new Event('visibilitychange'));

        expect(fetchFn).toHaveBeenCalledTimes(1);

        teardown();
    });

    it('raises nothing for a check still in flight at teardown', async () => {
        let respond!: (response: Response) => void;
        const { options, service, toasts } = makeHarness({ updates: { toastKey: 'app.updates.available' } });
        const fetchFn = vi.fn(
            () =>
                new Promise<Response>(resolve => {
                    respond = resolve;
                }),
        );

        const { updates, teardown } = wireMonitors({ ...options, fetchFn });
        const check = updates?.checkNow();

        teardown();
        respond(versionResponse('2.0.0'));
        await check;

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(toasts).not.toHaveBeenCalled();
        expect(service.toasts.value).toHaveLength(0);
    });
});

describe('wireMonitors connectivity', () => {
    it('pauses and resumes update polling with the injected window only', () => {
        const targetWindow = makeWindow();
        const { options } = makeHarness({ updates: { toastKey: 'app.updates.available' }, targetWindow });

        const { updates, connectivity, teardown } = wireMonitors(options);

        expect(connectivity).not.toBeNull();

        const stopSpy = vi.spyOn(updates as UpdateMonitor, 'stop');
        const startSpy = vi.spyOn(updates as UpdateMonitor, 'start');

        window.dispatchEvent(new Event('offline'));

        expect(stopSpy).not.toHaveBeenCalled();

        targetWindow.dispatchEvent(new Event('offline'));

        expect(stopSpy).toHaveBeenCalledTimes(1);

        targetWindow.dispatchEvent(new Event('online'));

        expect(startSpy).toHaveBeenCalledTimes(1);

        teardown();
    });

    it('holds update polling while offline at boot until the window comes back online', async () => {
        vi.useFakeTimers();

        try {
            const targetWindow = makeWindow(false);
            const targetDocument = makeVisibleDocument();
            const { options, fetchFn } = makeHarness({
                updates: { toastKey: 'app.updates.available', pollIntervalMs: 1_000 },
                targetWindow,
                targetDocument,
            });

            const { connectivity, teardown } = wireMonitors(options);

            await vi.advanceTimersByTimeAsync(5_000);
            targetDocument.dispatchEvent(new Event('visibilitychange'));

            expect(connectivity?.online).toBe(false);
            expect(fetchFn).not.toHaveBeenCalled();

            targetWindow.dispatchEvent(new Event('online'));
            await vi.advanceTimersByTimeAsync(1_000);

            expect(fetchFn).toHaveBeenCalledTimes(2);

            teardown();
        } finally {
            vi.useRealTimers();
        }
    });

    it('checks for a new version as soon as the window comes back online', async () => {
        const targetWindow = makeWindow();
        const { options, fetchFn, service } = makeHarness({
            updates: { toastKey: 'app.updates.available', pollIntervalMs: 600_000 },
            targetWindow,
        });

        const { teardown } = wireMonitors(options);

        targetWindow.dispatchEvent(new Event('offline'));

        expect(fetchFn).not.toHaveBeenCalled();

        targetWindow.dispatchEvent(new Event('online'));
        await vi.waitFor(() => {
            expect(service.toasts.value).toHaveLength(1);
        });

        expect(fetchFn).toHaveBeenCalledTimes(1);

        teardown();
    });

    it('polls regardless of connectivity when connectivity monitoring is disabled', async () => {
        vi.useFakeTimers();

        try {
            const { options, fetchFn } = makeHarness({
                updates: { toastKey: 'app.updates.available', pollIntervalMs: 1_000 },
                connectivity: { enabled: false },
                targetWindow: makeWindow(false),
            });

            const { teardown } = wireMonitors(options);

            await vi.advanceTimersByTimeAsync(1_000);

            expect(fetchFn).toHaveBeenCalledTimes(1);

            teardown();
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops both monitors on teardown so connectivity changes no longer restart polling', async () => {
        vi.useFakeTimers();

        try {
            const targetWindow = makeWindow();
            const { options, fetchFn } = makeHarness({
                updates: { toastKey: 'app.updates.available', pollIntervalMs: 1_000 },
                targetWindow,
            });

            const { connectivity, teardown } = wireMonitors(options);

            teardown();
            connectivity?.start();
            targetWindow.dispatchEvent(new Event('offline'));
            targetWindow.dispatchEvent(new Event('online'));
            await vi.advanceTimersByTimeAsync(5_000);

            expect(fetchFn).not.toHaveBeenCalled();

            connectivity?.stop();
        } finally {
            vi.useRealTimers();
        }
    });

    it('still stops update polling when stopping connectivity throws', async () => {
        vi.useFakeTimers();

        try {
            const failure = new Error('stop failed');
            const { options, fetchFn } = makeHarness({
                updates: { toastKey: 'app.updates.available', pollIntervalMs: 1_000 },
            });

            const { connectivity, teardown } = wireMonitors(options);

            vi.spyOn(connectivity as ConnectivityMonitor, 'stop').mockImplementation(() => {
                throw failure;
            });

            expect(teardown).toThrow(failure);

            await vi.advanceTimersByTimeAsync(5_000);

            expect(fetchFn).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('stays off when disabled explicitly while updates run', () => {
        const { options } = makeHarness({
            updates: { toastKey: 'app.updates.available' },
            connectivity: { enabled: false },
        });

        const { updates, connectivity } = wireMonitors(options);

        expect(updates).not.toBeNull();
        expect(connectivity).toBeNull();

        updates?.stop();
    });

    it('runs without an update monitor when enabled explicitly', () => {
        const { options } = makeHarness({ connectivity: { enabled: true }, targetWindow: window });

        const { updates, connectivity } = wireMonitors(options);

        expect(updates).toBeNull();
        expect(connectivity).not.toBeNull();
        expect(() => {
            window.dispatchEvent(new Event('offline'));
            window.dispatchEvent(new Event('online'));
        }).not.toThrow();

        connectivity?.stop();
    });

    it('uses the platform defaults when no seams are given', () => {
        const { updates, connectivity } = wireMonitors({
            settings: { app: { version: '1.0.0' } },
            runtimeUrl: '/runtime-env.json',
            toasts: () => new ToastService(),
            updates: { toastKey: 'app.updates.available' },
        });

        expect(updates).not.toBeNull();
        expect(connectivity).not.toBeNull();

        updates?.stop();
        connectivity?.stop();
    });
});
