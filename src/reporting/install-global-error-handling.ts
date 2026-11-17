/**
 * Global error handling that routes Vue and window errors to one reporter.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { App } from 'vue';

import type { BreadcrumbTrail } from '@sinemacula/foundation/reporting/breadcrumb-trail';
import type { ErrorReporter } from '@sinemacula/foundation/reporting/error-reporter';

/**
 * Options for installing global error handling.
 */
export interface GlobalErrorHandlingOptions {
    /** The Vue application instance to attach the error handler to. */
    readonly app: App;

    /** The reporter that receives every captured error or message. */
    readonly reporter: ErrorReporter;

    /** Optional breadcrumb trail; when present its snapshot is attached to every report. */
    readonly trail?: BreadcrumbTrail;

    /** The window to attach native error listeners to; defaults to the global window. */
    readonly targetWindow?: Window;
}

/** Marks a Vue error handler installed by {@link installGlobalErrorHandling} with its installation. */
const INSTALLATION = Symbol('installation');

/**
 * A Vue error handler, carrying its installation when this module installed it.
 */
type VueErrorHandler = NonNullable<App['config']['errorHandler']> & {
    /** The installation that put this handler in place. */
    readonly [INSTALLATION]?: Installation;
};

/**
 * The handler an installation replaced and whether it is still installed.
 */
interface Installation {
    /** The Vue error handler in place before this installation. */
    readonly previous: VueErrorHandler | undefined;

    /** Whether this installation has not been torn down yet. */
    active: boolean;
}

/**
 * Follow `handler` back past torn-down installations to the nearest live one.
 */
function nearestLive(handler: VueErrorHandler | undefined): VueErrorHandler | undefined {
    const installation = handler?.[INSTALLATION];

    return installation === undefined || installation.active ? handler : nearestLive(installation.previous);
}

/**
 * Forward Vue component errors, window errors and unhandled rejections to
 * `reporter`.
 *
 * @returns a teardown that removes the window listeners and, while its handler
 * is still the app's, restores the nearest handler that is still installed, so
 * installations can be torn down in any order; repeat calls are harmless
 */
export function installGlobalErrorHandling(options: GlobalErrorHandlingOptions): () => void {
    const { app, reporter, trail } = options;
    const target = options.targetWindow ?? globalThis.window;
    const installation: Installation = { previous: app.config.errorHandler, active: true };

    /**
     * Report a Vue error, or once torn down hand it to the nearest live handler,
     * rethrowing for Vue's default logging when there is none.
     */
    const handleError: VueErrorHandler = (err, instance, info) => {
        if (!installation.active) {
            const live = nearestLive(installation.previous);

            if (live === undefined) {
                throw err;
            }

            live(err, instance, info);

            return;
        }

        const context: Record<string, unknown> = { source: 'vue', info };

        if (trail !== undefined) {
            context['breadcrumbs'] = trail.list();
        }

        reporter.captureError(err, context);
    };

    const errorHandler: VueErrorHandler = Object.assign(handleError, { [INSTALLATION]: installation });

    app.config.errorHandler = errorHandler;

    /**
     * Forward a synchronous window error to the reporter with breadcrumbs.
     */
    const onError = (event: ErrorEvent): void => {
        const context: Record<string, unknown> = { source: 'window' };

        if (trail !== undefined) {
            context['breadcrumbs'] = trail.list();
        }

        reporter.captureError(event.error ?? event.message, context);
    };

    /**
     * Forward an unhandled promise rejection to the reporter with breadcrumbs.
     */
    const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
        const context: Record<string, unknown> = { source: 'unhandledrejection' };

        if (trail !== undefined) {
            context['breadcrumbs'] = trail.list();
        }

        reporter.captureError(event.reason, context);
    };

    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
        installation.active = false;

        if (app.config.errorHandler === errorHandler) {
            const restored = nearestLive(installation.previous);

            // The handler is an optional property, so an absent one is deleted.
            if (restored === undefined) {
                delete app.config.errorHandler;
            } else {
                app.config.errorHandler = restored;
            }
        }

        target.removeEventListener('error', onError);
        target.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
}
