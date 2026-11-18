/**
 * Tests that the hand-maintained TypeScript path map matches the package export
 * map every other tool derives its kernel subpaths from.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const tsconfig = JSON.parse(readFileSync('tsconfig.json', 'utf8'));

const PREFIX = '@sinemacula/foundation-web/';

describe('package contract', () => {
    it('maps every kernel export, and only those, in the TypeScript paths', () => {
        const exported = Object.keys(manifest.exports)
            .filter(subpath => subpath !== './eslint')
            .map(subpath => subpath.slice(2))
            .sort();
        const mapped = Object.keys(tsconfig.compilerOptions.paths)
            .filter(alias => alias.startsWith(PREFIX))
            .map(alias => alias.slice(PREFIX.length))
            .sort();

        expect(mapped).toEqual(exported);
    });

    it('points each mapped path at the source its export is built from', () => {
        for (const [subpath, target] of Object.entries(manifest.exports)) {
            if (typeof target === 'string') {
                continue;
            }

            const source = target.import.replace(/^\.\/dist\/(.+)\.js$/u, './src/$1.ts');

            expect(tsconfig.compilerOptions.paths[`${PREFIX}${subpath.slice(2)}`]).toEqual([source]);
        }
    });
});
