/**
 * Keeps the document title in sync with each route's translated `meta.title`.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Router } from 'vue-router';

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
 * Install an after-navigation hook setting the title to the translated
 * `meta.title` suffixed with the app name, or the app name alone.
 *
 * @returns a teardown removing the navigation hook
 */
export function installDocumentTitleSync(options: DocumentTitleOptions): () => void {
    const target = options.targetDocument ?? globalThis.document;

    return options.router.afterEach(route => {
        const key = route.meta.title;

        target.title = key === undefined ? options.appName : `${options.i18n.global.t(key)} | ${options.appName}`;
    });
}
