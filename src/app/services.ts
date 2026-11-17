/**
 * Web service singletons: the foundation surface plus the locale switcher.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import {
    confirmDialogs as baseConfirmDialogs,
    resetFoundationServices,
    toasts as baseToasts,
} from '@sinemacula/foundation/app/services';
import { createServiceHolder } from '@sinemacula/foundation/support/service-holder';
import type { LocaleSwitcher } from '../i18n/application-i18n';
import type { ConfirmService } from '../notifications/confirm-service';
import type { ToastService } from '../notifications/toast-service';

// biome-ignore lint/performance/noBarrelFile: the web composition root deliberately re-exports the base surface
export {
    analytics,
    api,
    appConfig,
    appConfigRepository,
    appStorage,
    colorScheme,
    featureFlags,
    installAnalytics,
    installApi,
    installColorScheme,
    installConfig,
    installConfirm,
    installFeatureFlags,
    installLogger,
    installRealtime,
    installReporting,
    installStorage,
    installToasts,
    logger,
    realtime,
    reporting,
} from '@sinemacula/foundation/app/services';

/**
 * The active toast service, narrowed so hosts can read its reactive queue.
 */
export function toasts(): ToastService {
    return baseToasts() as ToastService;
}

/**
 * The active confirmation dialog service, narrowed to the concrete reactive
 * service.
 */
export function confirmDialogs(): ConfirmService {
    return baseConfirmDialogs() as ConfirmService;
}

const localeSwitcherHolder = createServiceHolder<LocaleSwitcher>('locale switcher');

/**
 * Install the locale switcher; called once at boot.
 */
export function installLocaleSwitcher(instance: LocaleSwitcher): void {
    localeSwitcherHolder.install(instance);
}

/**
 * The active locale switcher.
 *
 * @throws Error when accessed before {@link installLocaleSwitcher} has been
 * called
 */
export function localeSwitcher(): LocaleSwitcher {
    return localeSwitcherHolder.resolve();
}

/**
 * Clear every service holder - base and web - back to uninstalled, between
 * tests or before booting a replacement application.
 */
export function resetWebCoreServices(): void {
    resetFoundationServices();
    localeSwitcherHolder.reset();
}
