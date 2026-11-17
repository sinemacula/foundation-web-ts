/**
 * Keep imports on other modules' public surfaces and on kernel subpaths.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

// biome-ignore-all lint/style/useNamingConvention: ESLint AST visitor keys

import path from 'node:path';
import { createRule, isTestPath, moduleFolder, moduleLocation, projectPath, staticString } from './lib.js';

const KERNEL_BARRELS = new Set(['@sinemacula/web-core', '@sinemacula/foundation']);

// A module's public surface, and its definition (open outside any module).
const PUBLIC_ENTRY = /^index(?:\.[jt]sx?)?$/;
const DEFINITION_ENTRY = /^module(?:\.[jt]sx?)?$/;

/**
 * The path an alias (`@/...`) or relative specifier points at, or null for a
 * package specifier.
 */
function specifierPath(specifier, filename) {
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
        return path.posix.join(path.posix.dirname(filename), specifier);
    }

    return specifier.startsWith('@/') ? specifier : null;
}

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
        const filename = projectPath(context);

        if (isTestPath(filename)) {
            return {};
        }

        const ownModule = moduleFolder(filename);

        /** Whether a path inside another module is one that module exposes to this file. */
        function isExposed(entry) {
            return PUBLIC_ENTRY.test(entry) || (ownModule === null && DEFINITION_ENTRY.test(entry));
        }

        /** Report on an import/export source that crosses a boundary. */
        function check(source) {
            // A local `export { x }` or a computed import has no static source.
            const specifier = staticString(source);

            if (specifier === null) {
                return;
            }

            if (KERNEL_BARRELS.has(specifier)) {
                context.report({ node: source, messageId: 'barrel' });

                return;
            }

            const target = specifierPath(specifier, filename);
            const location = target === null ? null : moduleLocation(target);

            if (location !== null && location.folder !== ownModule && !isExposed(location.entry)) {
                context.report({ node: source, messageId: 'crossModule', data: { module: location.folder } });
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
