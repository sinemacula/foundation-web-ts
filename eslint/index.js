/**
 * Flat-config preset enforcing the web-core `modules/<name>/...` contract.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';
import plugin from './plugin.js';

const TS_FILES = ['**/*.ts', '**/*.tsx'];
const VUE_FILES = ['**/*.vue'];
const MODULE_TS_FILES = ['**/modules/**/*.ts', '**/modules/**/*.tsx'];

/** Rules applied to every TypeScript and Vue file. */
const CONVENTIONS = {
    '@sinemacula/web-core/no-snake-case-keys': 'error',
    '@sinemacula/web-core/module-import-boundary': 'error',
};

export default [
    {
        files: TS_FILES,
        plugins: {
            '@sinemacula/web-core': plugin,
        },
        languageOptions: {
            parser: tseslint.parser,
        },
        rules: CONVENTIONS,
    },
    {
        files: VUE_FILES,
        plugins: {
            '@sinemacula/web-core': plugin,
        },
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tseslint.parser,
            },
        },
        rules: CONVENTIONS,
    },
    {
        files: MODULE_TS_FILES,
        plugins: {
            '@sinemacula/web-core': plugin,
        },
        languageOptions: {
            parser: tseslint.parser,
        },
        rules: {
            '@sinemacula/web-core/module-name-matches-folder': 'error',
            '@sinemacula/web-core/module-export-names': 'error',
            '@sinemacula/web-core/route-name-namespacing': 'error',
            '@sinemacula/web-core/route-name-via-constant': 'error',
        },
    },
];
