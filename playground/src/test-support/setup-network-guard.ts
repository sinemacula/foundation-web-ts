/**
 * Test setup file replacing every network entry point (`fetch`, `WebSocket`,
 * `EventSource`, `XMLHttpRequest` and `navigator.sendBeacon`) with a stub that
 * throws.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { PlaygroundError } from '@/errors/playground-error';

/**
 * Build the error a unit test gets for reaching `entryPoint`.
 */
function networkAccess(entryPoint: string): PlaygroundError {
    return new PlaygroundError(
        `Unit tests must not touch the network (${entryPoint}). Inject a stub or use vi.stubGlobal("${entryPoint}", ...).`,
    );
}

/**
 * Build a constructor that throws as soon as a test instantiates it.
 */
function blockedConstructor(entryPoint: string): new () => never {
    /**
     * Stands in for the real constructor and rejects every instantiation.
     */
    class Blocked {
        /**
         * Reject the connection attempt.
         */
        constructor() {
            throw networkAccess(entryPoint);
        }
    }

    return Blocked as unknown as new () => never;
}

/**
 * Reject any fetch attempted from a unit test.
 */
const blockedFetch: typeof fetch = () => {
    throw networkAccess('fetch');
};

globalThis.fetch = blockedFetch;

for (const entryPoint of ['WebSocket', 'EventSource', 'XMLHttpRequest'] as const) {
    Object.defineProperty(globalThis, entryPoint, {
        configurable: true,
        writable: true,
        value: blockedConstructor(entryPoint),
    });
}

Object.defineProperty(globalThis.navigator, 'sendBeacon', {
    configurable: true,
    writable: true,
    value: (): never => {
        throw networkAccess('navigator.sendBeacon');
    },
});
