/**
 * Vitest config running the eslint preset's suite on its own.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['eslint/**/*.test.js'],
    },
});
