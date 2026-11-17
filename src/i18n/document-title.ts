/**
 * Keeps the document title in sync with each route's translated `meta.title`.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { watch } from 'vue';
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';

import type { ApplicationI18n } from './application-i18n';

/**
 * Options for installing the document title synchronisation hook.
 */
export interface DocumentTitleOptions {
    /** The router whose navigations drive the title. */
    readonly router: Router;

    /** The i18n instance used to translate the title key. */
    readonly i18n: ApplicationI18n;

    /** The application name suffixed to every title. */
    readonly appName: string;

    /** The document whose title is set; defaults to the global document. */
    readonly targetDocument?: Document;
}

/**
 * Keep the title on the current route's translated `meta.title` suffixed with
 * the app name, or the app name alone, across navigations and locale switches.
 *
 * @returns a teardown stopping the synchronisation
 */
export function installDocumentTitleSync(options: DocumentTitleOptions): () => void {
    const target = options.targetDocument ?? globalThis.document;

    /**
     * Resolve the title for `route` in the active locale.
     */
    const titleOf = (route: RouteLocationNormalizedLoaded): string => {
        const key = route.meta.title;

        return key === undefined ? options.appName : `${options.i18n.global.t(key)} | ${options.appName}`;
    };

    return watch(
        [() => options.router.currentRoute.value, () => titleOf(options.router.currentRoute.value)],
        ([, title]) => {
            target.title = title;
        },
    );
}
