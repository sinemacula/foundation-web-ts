/**
 * Whether the browser keeps the cookies an application relies on.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

/** Receives the cookie support once it changes. */
export type CookieSupportHandler = (accepted: boolean) => void;

/** Options for {@link CookieSupport}. */
export interface CookieSupportOptions {
    /** The window whose cookies are checked; defaults to the global window. */
    readonly targetWindow?: Window;

    /** Receives an error thrown by a subscriber, which never stops the others; defaults to the global `reportError`. */
    readonly onError?: (error: unknown) => void;
}

/**
 * Reports whether cookies work, checked once when built: the browser must have
 * cookies enabled and keep a test cookie written to it. It raises no event when
 * cookie settings change, so a later change is seen on the next page load.
 * {@link block} marks cookies blocked for the rest of the page load, as when a
 * refresh arrives without the cookie issued moments before.
 */
export class CookieSupport {
    /** The registered subscribers. */
    readonly #handlers = new Set<CookieSupportHandler>();

    /** Receives errors thrown by subscribers. */
    readonly #onError: (error: unknown) => void;

    /** Whether cookies work. */
    #accepted: boolean;

    constructor(options: CookieSupportOptions = {}) {
        this.#accepted = keepsTestCookie(options.targetWindow ?? globalThis.window);
        this.#onError = options.onError ?? (error => globalThis.reportError(error));
    }

    /**
     * Whether cookies work.
     */
    get accepted(): boolean {
        return this.#accepted;
    }

    /**
     * Mark cookies blocked until the page reloads, notifying subscribers the
     * first time.
     */
    block(): void {
        if (!this.#accepted) {
            return;
        }

        this.#accepted = false;

        for (const handler of this.#handlers) {
            try {
                handler(false);
            } catch (error) {
                this.#report(error);
            }
        }
    }

    /**
     * Subscribe to changes.
     *
     * @returns an unsubscribe function
     */
    onChange(handler: CookieSupportHandler): () => void {
        this.#handlers.add(handler);

        return () => {
            this.#handlers.delete(handler);
        };
    }

    /**
     * Pass a subscriber's error to the sink, ignoring a throwing sink.
     */
    #report(error: unknown): void {
        try {
            this.#onError(error);
        } catch {
            // The sink is the last resort; nothing is left to report to.
        }
    }
}

/**
 * Whether the browser has cookies enabled and keeps a uniquely named test
 * cookie, deleted again before returning. A document that throws on cookie
 * access, such as a sandboxed frame, keeps none. The name is random without a
 * secure context, which plain HTTP pages lack.
 */
function keepsTestCookie(targetWindow: Window): boolean {
    try {
        if (!targetWindow.navigator.cookieEnabled) {
            return false;
        }

        const { document } = targetWindow;
        const id = Array.from(targetWindow.crypto.getRandomValues(new Uint32Array(2)), part => part.toString(36));
        const name = `cookie-check-${id.join('')}`;
        const attributes = `; Path=/; SameSite=Strict${targetWindow.location.protocol === 'https:' ? '; Secure' : ''}`;

        document.cookie = `${name}=1; Max-Age=60${attributes}`;

        try {
            return document.cookie.split('; ').includes(`${name}=1`);
        } finally {
            document.cookie = `${name}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT${attributes}`;
        }
    } catch {
        return false;
    }
}
