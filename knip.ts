/**
 * Knip dead-code detection configuration.
 *
 * The repository is an npm workspace: the kernel package at the root plus the
 * playground harness. Kernel production entries are the sources behind the
 * manifest's conditional `exports`, which point at the compiled `dist` output;
 * the plain-JS eslint preset export already names a source file, which Knip
 * reads directly. Vue single-file components are compiled down to their script
 * blocks so Knip can follow imports through `.vue` files.
 *
 * The vite/vitest plugins are disabled in favour of listing the config files as
 * static entries: executing the Vite config under Knip's loader breaks on
 * ESM-only plugin packages, while static analysis resolves the same
 * dependencies without running anything.
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
