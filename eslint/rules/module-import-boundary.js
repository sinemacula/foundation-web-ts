/**
 * Keep imports on other modules' public surfaces and on kernel subpaths.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

// biome-ignore-all lint/style/useNamingConvention: ESLint AST visitor keys

import { createRule, isTestPath, moduleFolder } from './lib.js';

const KERNEL_BARRELS = new Set(['@sinemacula/web-core', '@sinemacula/foundation']);

// The bare `@/modules/<name>` public surface does not match.
const MODULE_INTERNAL = /^@\/modules\/([^/]+)\/.+/;

// Stryker disable all: declarative rule metadata
export default createRule({
    name: 'module-import-boundary',
    meta: {
        type: 'problem',
        docs: {
            description: 'Reach other modules through their public surface, and the kernel by subpath.',
        },
        schema: [],
        messages: {
            barrel: 'Import a kernel subpath (@sinemacula/web-core/<area>/<file> or @sinemacula/foundation/<area>/<file>), not a package barrel.',
            crossModule:
                "Reach module '{{module}}' through its public surface (@/modules/{{module}}), not its internals.",
        },
    },
    defaultOptions: [],
    // Stryker restore all
    create(context) {
        const filename = context.filename.replace(/\\/g, '/');

        if (isTestPath(filename)) {
            return {};
        }

        const ownModule = moduleFolder(filename);

        /** Report on an import/export source that crosses a boundary. */
        function check(source) {
            // A local `export { x }` has a null source.
            if (source?.type !== 'Literal') {
                return;
            }

            if (KERNEL_BARRELS.has(source.value)) {
                context.report({ node: source, messageId: 'barrel' });

                return;
            }

            const match = MODULE_INTERNAL.exec(source.value);

            if (match !== null && match[1] !== ownModule) {
                context.report({ node: source, messageId: 'crossModule', data: { module: match[1] } });
            }
        }

        return {
            ImportDeclaration(node) {
                check(node.source);
            },
            ImportExpression(node) {
                check(node.source);
            },
            ExportNamedDeclaration(node) {
                check(node.source);
            },
            ExportAllDeclaration(node) {
                check(node.source);
            },
        };
    },
});
