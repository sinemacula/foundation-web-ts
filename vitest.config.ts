/**
 * Vitest config; kernel subpath imports resolve to source, so no build runs.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

import manifest from './package.json' with { type: 'json' };

const kernelSubpaths = Object.keys(manifest.exports)
    .filter(subpath => subpath !== './eslint')
    .map(subpath => subpath.slice(2));

export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: [
            { find: '@', replacement: resolve(process.cwd(), 'playground/src') },
            {
                find: new RegExp(`^@sinemacula/web-core/(${kernelSubpaths.join('|')})$`),
                replacement: `${fileURLToPath(new URL('./src/', import.meta.url))}$1.ts`,
            },
        ],
    },
    test: {
        environment: 'happy-dom',
        unstubGlobals: true,
        restoreMocks: true,
        setupFiles: ['playground/src/test-support/setup-network-guard.ts'],
        include: [
            'src/**/*.test.ts',
            'playground/src/**/*.test.ts',
            'playground/scripts/**/*.test.ts',
            'eslint/**/*.test.js',
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            // SFCs stay thin wiring; behaviour lives in covered `.ts` modules.
            include: ['src/**/*.ts', 'playground/src/**/*.ts', 'eslint/**/*.js'],
            exclude: [
                '**/*.test.ts',
                '**/*.test.js',
                'eslint/**/__tests__/tester.js',
                'eslint/vitest.config.mjs',
                'playground/src/main.ts',
                '**/test-support/**',
                '**/*.d.ts',
            ],
            thresholds: {
                lines: 100,
                functions: 100,
                branches: 100,
                statements: 100,
            },
        },
    },
});
