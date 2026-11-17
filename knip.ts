/**
 * Knip config; entries map the `dist` exports back to their sources.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { KnipConfig } from 'knip';

import manifest from './package.json' with { type: 'json' };

const SCRIPT_BLOCK = /<script[^>]*>([\s\S]*?)<\/script\s*>/gim;

const sourceEntries = Object.values(manifest.exports)
    .filter(target => typeof target !== 'string')
    .map(({ import: target }) => target.replace(/^\.\/dist\/(.+)\.js$/, 'src/$1.ts'));

const config: KnipConfig = {
    workspaces: {
        '.': {
            entry: [
                ...sourceEntries,
                'src/**/*.test.ts',
                'e2e/**/*.spec.ts',
                'vitest.config.ts',
                'playwright.config.ts',
                'eslint/**/*.test.js',
                'eslint/vitest.config.mjs',
            ],
            project: ['src/**/*.ts', 'e2e/**/*.ts', 'eslint/**/*.js'],
            playwright: false,
            // Loading Vite configs under Knip breaks on ESM-only plugins.
            vitest: false,
        },
        playground: {
            entry: ['src/main.ts', 'src/**/*.test.ts', 'src/test-support/setup-network-guard.ts', 'vite.config.ts'],
            project: ['src/**/*.ts', 'src/**/*.vue'],
            vite: false,
        },
    },
    ignoreBinaries: ['qlty'],
    ignoreExportsUsedInFile: true,
    compilers: {
        vue: (text: string) => [...text.matchAll(SCRIPT_BLOCK)].map(match => match[1]).join('\n'),
    },
};

export default config;
