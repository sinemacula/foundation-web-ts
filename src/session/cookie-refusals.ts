/**
 * Carries refused refresh cookies to the application's cookie support.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { CookieSupport } from '../cookies/cookie-support';

/**
 * Holds a refusal reported before the session boots until the cookie support is
 * attached, then passes every refusal straight on.
 */
export class CookieRefusals {
    /** The cookie support told of refusals, or null until attached. */
    #support: CookieSupport | null = null;

    /** Whether a refusal was reported. */
    #refused = false;

    /**
     * Report a refresh that arrived without the cookie it needed.
     */
    report(): void {
        this.#refused = true;
        this.#support?.block();
    }

    /**
     * Attach the cookie support, telling it of any earlier refusal; null when
     * the application provides none.
     */
    attach(support: CookieSupport | null): void {
        this.#support = support;

        if (this.#refused) {
            support?.block();
        }
    }
}
