/**
 * The access tokens the session has sent, for telling a stale 401 apart.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { HttpRequest } from '@sinemacula/foundation/http/http-client';

const DEFAULT_CAPACITY = 32;

/**
 * Remembers the latest access tokens the session attached to requests, so a
 * 401 for a request sent with one the session has since replaced is retried
 * on the current token instead of refreshing again. The oldest token is
 * forgotten past the capacity, and a 401 for it then refreshes.
 */
export class SessionTokenHistory {
    /** The remembered tokens, oldest first. */
    readonly #tokens: Set<string> = new Set();

    /** How many tokens are remembered. */
    readonly #capacity: number;

    constructor(capacity: number = DEFAULT_CAPACITY) {
        this.#capacity = capacity;
    }

    /**
     * Remember the bearer token the session attached to a request.
     */
    record(request: HttpRequest): void {
        const token = bearerOf(request);

        if (token === null) {
            return;
        }

        this.#tokens.delete(token);
        this.#tokens.add(token);

        if (this.#tokens.size > this.#capacity) {
            this.#tokens.delete(this.#tokens.values().next().value as string);
        }
    }

    /**
     * Whether a request was sent with a session token other than the current
     * one, while the session holds a current one.
     */
    isSuperseded(request: HttpRequest, current: string | null): boolean {
        const token = bearerOf(request);

        return token !== null && current !== null && token !== current && this.#tokens.has(token);
    }
}

/**
 * Read the bearer token a request carries, if any.
 */
function bearerOf(request: HttpRequest): string | null {
    return /^Bearer (.+)$/u.exec(request.headers['authorization'] ?? '')?.[1] ?? null;
}
