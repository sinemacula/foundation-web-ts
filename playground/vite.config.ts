/**
 * Vite build configuration.
 *
 * The application builds to a static, environment-agnostic artifact: no
 * environment variable is baked into the bundle at build time. Runtime
 * configuration is delivered through `runtime-env.json`, rendered at deploy
 * time by `scripts/generate-runtime-env.mjs` and uploaded alongside the
 * artifact.
 *
 * Kernel subpath imports resolve to source, so the playground runs and builds
 * without a package build.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

import manifest from '../package.json' with { type: 'json' };

const kernelSubpaths = Object.keys(manifest.exports)
    .filter(subpath => subpath !== './eslint')
    .map(subpath => subpath.slice(2));

export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: [
            { find: '@', replacement: resolve(process.cwd(), 'src') },
            {
                find: new RegExp(`^@sinemacula/web-core/(${kernelSubpaths.join('|')})$`),
                replacement: `${fileURLToPath(new URL('../src/', import.meta.url))}$1.ts`,
            },
        ],
    },
    build: {
        // Pinned explicitly; Vite has shifted this default floor before.
        target: 'baseline-widely-available',
        // Off until an error reporter uploads them: even 'hidden' writes
        // readable .map files into the artifact promoted to S3.
        sourcemap: false,
    },
});
