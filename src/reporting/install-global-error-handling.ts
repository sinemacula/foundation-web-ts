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

/**
 * Forward Vue component errors, window errors and unhandled rejections to
 * `reporter`.
 *
 * @returns a teardown that restores the previous Vue error handler and removes
 * the window listeners; repeat calls are no-ops
 */
export function installGlobalErrorHandling(options: GlobalErrorHandlingOptions): () => void {
    const { app, reporter, trail } = options;
    const target = options.targetWindow ?? globalThis.window;
    const previousErrorHandler = app.config.errorHandler;

    app.config.errorHandler = (err, _instance, info) => {
        const context: Record<string, unknown> = { source: 'vue', info };

        if (trail !== undefined) {
            context['breadcrumbs'] = trail.list();
        }

        reporter.captureError(err, context);
    };

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

    let installed = true;

    return () => {
        if (!installed) {
            return;
        }

        installed = false;

        // The handler is an optional property, so an absent one is deleted.
        if (previousErrorHandler === undefined) {
            delete app.config.errorHandler;
        } else {
            app.config.errorHandler = previousErrorHandler;
        }

        target.removeEventListener('error', onError);
        target.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
}
