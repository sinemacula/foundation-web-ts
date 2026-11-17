/**
 * Error raised when middleware redirects keep a navigation from settling.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

/**
 * Thrown into the router's error flow when one navigation is redirected by
 * middleware more times than the limit allows.
 */
export class RedirectLoopError extends Error {
    /** The location the redirected navigation started from. */
    readonly origin: string;

    /** The redirect target the limit refused. */
    readonly target: string;

    /** The number of middleware redirects one navigation may take. */
    readonly limit: number;

    /**
     * Construct the error naming the navigation, refused target and limit.
     */
    constructor(origin: string, target: string, limit: number) {
        super(`Navigation to "${origin}" exceeded ${limit} middleware redirects; the next was to "${target}".`);
        this.name = 'RedirectLoopError';
        this.origin = origin;
        this.target = target;
        this.limit = limit;
    }
}
