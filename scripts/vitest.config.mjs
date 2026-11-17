/**
 * Vitest config running the repo scripts' suite in Node.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['scripts/**/*.test.mjs'],
    },
});
