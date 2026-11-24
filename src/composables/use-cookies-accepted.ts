/**
 * Reactive cookie support for components, such as a cookies blocked view.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { InjectionKey, Ref } from 'vue';
import { inject } from 'vue';
import type { CookieSupport } from '../cookies/cookie-support';
import { followFlag } from './follow-flag';

/**
 * Thrown by {@link useCookiesAccepted} outside the application.
 */
export class CookieSupportUnavailableError extends Error {
    /**
     * Construct the error explaining why no cookie support is available.
     */
    constructor() {
        super('useCookiesAccepted() needs the cookie support the application provides.');
        this.name = 'CookieSupportUnavailableError';
    }
}

/** Provides the application's cookie support to its components. */
export const COOKIE_SUPPORT: InjectionKey<CookieSupport> = Symbol('cookie-support');

/**
 * Follow whether cookies work: false when the browser refuses them, checked
 * once per page load, or once a refresh arrives without the cookie issued with
 * a still live session. Unsubscribes with the calling scope.
 *
 * @throws {CookieSupportUnavailableError} when the caller is outside the
 * application
 */
export function useCookiesAccepted(): Readonly<Ref<boolean>> {
    const support = inject(COOKIE_SUPPORT, null);

    if (support === null) {
        throw new CookieSupportUnavailableError();
    }

    return followFlag(support.accepted, handler => support.onChange(handler));
}
