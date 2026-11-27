/**
 * Router wiring for the bootstrap preset.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Router, RouterHistory } from 'vue-router';

import type { ApplicationI18n } from '../i18n/application-i18n';
import { installDocumentTitleSync } from '../i18n/document-title';
import type { RouteMessages } from '../i18n/route-messages';
import { ownedModuleRoutes } from '../i18n/route-messages';
import type { ModuleDefinition } from '../module/module';
import { collectModuleGuards, collectModuleRoutes } from '../module/module';
import { createApplicationRouter } from '../router/router-factory';

/**
 * Options for {@link wireRouter}.
 */
export interface WireRouterOptions {
    /** The registry's ordered module list, the source of routes and guards. */
    readonly modules: readonly ModuleDefinition[];

    /** The i18n instance translating `meta.title` keys for the document title. */
    readonly i18n: ApplicationI18n;

    /** The application name suffixed onto every document title. */
    readonly appName: string;

    /** The router history implementation; defaults to web history. */
    readonly history?: RouterHistory;

    /** The document whose title is synchronised. */
    readonly targetDocument?: Document;

    /** Loads each navigation's module messages with its routes; module messages load with the locale when omitted. */
    readonly routeMessages?: RouteMessages;
}

/**
 * The wired router and the title-sync teardown.
 */
export interface WiredRouter {
    /** The wired application router. */
    readonly router: Router;

    /** Removes the document-title synchronisation hook. */
    readonly titleSyncTeardown: () => void;
}

/**
 * Build the router from module routes and guards, and install document-title
 * sync.
 */
export function wireRouter(options: WireRouterOptions): WiredRouter {
    const router = createApplicationRouter({
        routes:
            options.routeMessages === undefined
                ? collectModuleRoutes(options.modules)
                : ownedModuleRoutes(options.modules),
        ...(options.history === undefined ? {} : { history: options.history }),
        globalMiddleware: collectModuleGuards(options.modules),
        ...(options.routeMessages === undefined ? {} : { onNavigationStart: options.routeMessages.start }),
    });

    const titleSyncTeardown = installDocumentTitleSync({
        router,
        i18n: options.i18n,
        appName: options.appName,
        ...(options.targetDocument === undefined ? {} : { targetDocument: options.targetDocument }),
    });

    return { router, titleSyncTeardown };
}
