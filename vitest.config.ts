/**
 * Vitest test-runner configuration.
 *
 * Tests are colocated with source (`*.test.ts`). Coverage over the kernel spans
 * the plain TypeScript surface: Vue single-file components are kept thin
 * (template plus wiring) so every line of behaviour lives in fully-covered
 * `.ts` modules. The eslint preset ships as plain JS with its own RuleTester
 * suite; it is folded in here so it clears the same coverage and mutation gates
 * rather than running blind alongside them.
 *
 * Kernel subpath imports resolve to source, so the suite runs without a build.
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
        setupFiles: ['playground/src/test-support/setup-network-guard.ts'],
        include: ['src/**/*.test.ts', 'playground/src/**/*.test.ts', 'eslint/**/*.test.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['src/**/*.ts', 'playground/src/**/*.ts', 'eslint/**/*.js'],
            exclude: [
                '**/*.test.ts',
                '**/*.test.js',
                'eslint/**/__tests__/tester.js',
                'eslint/vitest.config.mjs',
                'playground/src/main.ts',
                '**/test-support/**',
                '**/*.d.ts',
                'repos/**',
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
