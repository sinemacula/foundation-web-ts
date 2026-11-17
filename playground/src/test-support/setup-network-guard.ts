/**
 * Test setup file replacing global `fetch` with a stub that throws.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { PlaygroundError } from '@/errors/playground-error';

/**
 * Reject any network access attempted from a unit test.
 */
const guard: typeof fetch = () => {
    throw new PlaygroundError(
        'Unit tests must not touch the network. Inject a fetchFn stub or use vi.stubGlobal("fetch", ...).',
    );
};

globalThis.fetch = guard;
