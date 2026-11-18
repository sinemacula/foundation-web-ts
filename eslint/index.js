/**
 * Flat-config preset enforcing the foundation-web `modules/<name>/...`
 * contract.
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
    '@sinemacula/foundation-web/no-snake-case-keys': 'error',
    '@sinemacula/foundation-web/module-import-boundary': 'error',
};

export default [
    {
        files: TS_FILES,
        plugins: {
            '@sinemacula/foundation-web': plugin,
        },
        languageOptions: {
            parser: tseslint.parser,
        },
        rules: CONVENTIONS,
    },
    {
        files: VUE_FILES,
        plugins: {
            '@sinemacula/foundation-web': plugin,
        },
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tseslint.parser,
            },
        },
        rules: CONVENTIONS,
    },
    // A subset of TS_FILES, so the block above supplies the plugin and parser.
    {
        files: MODULE_TS_FILES,
        rules: {
            '@sinemacula/foundation-web/module-name-matches-folder': 'error',
            '@sinemacula/foundation-web/module-export-names': 'error',
            '@sinemacula/foundation-web/route-name-namespacing': 'error',
            '@sinemacula/foundation-web/route-name-via-constant': 'error',
        },
    },
];
