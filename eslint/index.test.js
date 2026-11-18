/**
 * Tests for which rules the preset enables on which files.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import config from './index.js';

const linter = new Linter({ configType: 'flat' });

/** Source breaking every foundation-web rule that could apply to its file. */
const VIOLATIONS = [
    "import { x } from '@sinemacula/foundation-web';",
    'export const payload = { snake_key: x };',
    "export const AUTH_ROUTE_NAMES = { home: 'home' };",
    "export const wrong: ModuleDefinition = { name: 'login' };",
    "export const records = [{ path: '/', name: 'auth.home' }];",
].join('\n');

/** Lint a code snippet as though it lived at the given filename. */
function lint(code, filename) {
    return linter.verify(code, config, { filename });
}

/** Extract the rule id from each lint message. */
function ruleIds(messages) {
    return messages.map(message => message.ruleId);
}

/** The distinct foundation-web rule names reported, sorted, with the plugin prefix dropped. */
function reportedRules(messages) {
    return [...new Set(ruleIds(messages).map(id => id?.replace('@sinemacula/foundation-web/', '')))].sort();
}

describe('preset config', () => {
    it.each([
        ['src/app.ts', ['module-import-boundary', 'no-snake-case-keys']],
        [
            'src/modules/auth/module.ts',
            ['module-export-names', 'module-import-boundary', 'module-name-matches-folder', 'no-snake-case-keys'],
        ],
        [
            'src/modules/auth/routes.ts',
            ['module-export-names', 'module-import-boundary', 'no-snake-case-keys', 'route-name-via-constant'],
        ],
        [
            'src/modules/auth/routes.tsx',
            ['module-export-names', 'module-import-boundary', 'no-snake-case-keys', 'route-name-via-constant'],
        ],
        ['src/modules/auth/route-names.ts', ['module-import-boundary', 'no-snake-case-keys', 'route-name-namespacing']],
    ])('enables exactly the applicable rules on %s', (filename, expected) => {
        expect(reportedRules(lint(VIOLATIONS, filename))).toEqual(expected);
    });

    it.each(['src/App.vue', 'src/modules/auth/views/login-view.vue'])(
        'enables only the conventions inside %s',
        filename => {
            const messages = lint(`<script setup lang="ts">\n${VIOLATIONS}\n</script>`, filename);

            expect(reportedRules(messages)).toEqual(['module-import-boundary', 'no-snake-case-keys']);
        },
    );

    it('exempts test files from the import boundary', () => {
        const messages = lint("import { x } from '@/modules/users/composables/use-thing';", 'src/app.test.ts');

        expect(messages).toEqual([]);
    });

    it('applies the feature-module contract only under modules/', () => {
        expect(lint('export const AUTH_ROUTES = {} as const;', 'src/config/routes.ts')).toEqual([]);
    });

    it('parses TypeScript-only syntax in .ts files', () => {
        const code = "import type { Foo } from './foo';\nexport const value = { a: 1 } satisfies Foo;";

        expect(lint(code, 'src/app.ts')).toEqual([]);
    });

    it('parses generic TypeScript single-file components', () => {
        const code = [
            '<script setup lang="ts" generic="T extends string">',
            'defineProps<{ a: T }>();',
            'const o = { snake_key: 1 };',
            '</script>',
        ].join('\n');

        expect(ruleIds(lint(code, 'src/components/item-list.vue'))).toEqual([
            '@sinemacula/foundation-web/no-snake-case-keys',
        ]);
    });
});

describe('preset in a flat config', () => {
    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [...tseslint.configs.recommended, ...config],
    });

    /** Lint source through the ESLint class as though it lived at the given path. */
    async function lintText(code, filePath) {
        const [result] = await eslint.lintText(code, { filePath });

        return ruleIds(result.messages);
    }

    it('reports foundation-web rules after another preset', async () => {
        const names = "export const AUTH_ROUTE_NAMES = { login: 'login' } as const;";
        const component =
            '<script setup lang="ts">\nimport { x } from \'@/modules/users/composables/use-thing\';\nx();\n</script>';

        expect(await lintText(names, 'src/modules/auth/route-names.ts')).toEqual([
            '@sinemacula/foundation-web/route-name-namespacing',
        ]);
        expect(await lintText(component, 'src/App.vue')).toEqual(['@sinemacula/foundation-web/module-import-boundary']);
    });

    it('passes conforming sources', async () => {
        const names = "export const AUTH_ROUTE_NAMES = { login: 'auth.login' } as const;";
        const component = '<script setup lang="ts">\nimport { x } from \'@/modules/users\';\nx();\n</script>';

        expect(await lintText(names, 'src/modules/auth/route-names.ts')).toEqual([]);
        expect(await lintText(component, 'src/App.vue')).toEqual([]);
    });
});
