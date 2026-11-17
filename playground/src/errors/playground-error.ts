/**
 * Application error type, distinct from kernel and transport errors.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

/**
 * A failure raised by the playground application's own code.
 */
export class PlaygroundError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'PlaygroundError';
    }
}
