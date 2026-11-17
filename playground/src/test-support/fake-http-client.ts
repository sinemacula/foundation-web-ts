/**
 * Call-recording {@link HttpClient} fake; an empty queue resolves undefined.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { HttpClient, HttpRequestOptions } from '@sinemacula/foundation/http/http-client';

interface RecordedCall {
    /** The HTTP method invoked. */
    readonly method: string;

    /** The request path. */
    readonly path: string;

    /** The request body, if any. */
    readonly body: unknown;

    /** The request options, if any. */
    readonly options?: HttpRequestOptions;
}

type QueuedResult =
    | {
          /** Marks a queued success. */
          readonly kind: 'resolve';

          /** The value the next call resolves with. */
          readonly value: unknown;
      }
    | {
          /** Marks a queued failure. */
          readonly kind: 'reject';

          /** The error the next call rejects with. */
          readonly error: unknown;
      };

/**
 * A scriptable, call-recording HTTP client.
 */
export class FakeHttpClient implements HttpClient {
    /** Every call made against this client, in order. */
    readonly calls: RecordedCall[] = [];

    /** The results still queued to replay, in order. */
    readonly #queue: QueuedResult[] = [];

    /**
     * Queue a payload for the next call to resolve with.
     */
    queueResponse(value: unknown): void {
        this.#queue.push({ kind: 'resolve', value });
    }

    /**
     * Queue an error for the next call to reject with.
     */
    queueError(error: unknown): void {
        this.#queue.push({ kind: 'reject', error });
    }

    /**
     * Record a GET and replay the next queued result.
     */
    get<T>(path: string, options?: HttpRequestOptions): Promise<T> {
        return this.#consume('GET', path, undefined, options);
    }

    /**
     * Record a POST and replay the next queued result.
     */
    post<T>(path: string, body?: unknown, options?: HttpRequestOptions): Promise<T> {
        return this.#consume('POST', path, body, options);
    }

    /**
     * Record a PUT and replay the next queued result.
     */
    put<T>(path: string, body?: unknown, options?: HttpRequestOptions): Promise<T> {
        return this.#consume('PUT', path, body, options);
    }

    /**
     * Record a PATCH and replay the next queued result.
     */
    patch<T>(path: string, body?: unknown, options?: HttpRequestOptions): Promise<T> {
        return this.#consume('PATCH', path, body, options);
    }

    /**
     * Record a DELETE and replay the next queued result.
     */
    delete<T>(path: string, options?: HttpRequestOptions): Promise<T> {
        return this.#consume('DELETE', path, undefined, options);
    }

    /**
     * Record a GET and replay the next queued result as a Blob.
     */
    download(path: string, options?: HttpRequestOptions): Promise<Blob> {
        return this.#consume('GET', path, undefined, options);
    }

    /**
     * Record the call and resolve or reject with the next queued result.
     */
    #consume<T>(method: string, path: string, body: unknown, options: HttpRequestOptions | undefined): Promise<T> {
        this.calls.push({ method, path, body, options });

        const result = this.#queue.shift() ?? { kind: 'resolve', value: undefined };

        return result.kind === 'reject' ? Promise.reject(result.error) : Promise.resolve(result.value as T);
    }
}
