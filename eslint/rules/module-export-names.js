/**
 * Require each module contract file to export its folder-derived binding name.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

// biome-ignore-all lint/style/useNamingConvention: ESLint AST visitor keys

import { contractFile, createRule, moduleFolder, projectPath, toCamelCase, toUpperSnakeCase } from './lib.js';

/** Canonical export name builders, keyed by contract basename. */
const EXPORT_NAMES = {
    module: folder => `${toCamelCase(folder)}Module`,
    routes: folder => `${toCamelCase(folder)}Routes`,
    'route-names': folder => `${toUpperSnakeCase(folder)}_ROUTE_NAMES`,
};

/** Names bound by an `export const` declaration. */
function declaredNames(node) {
    if (node.declaration?.type !== 'VariableDeclaration') {
        return [];
    }

    return node.declaration.declarations
        .filter(declarator => declarator.id.type === 'Identifier')
        .map(declarator => declarator.id.name);
}

/** Value names exported through an `export { ... }` clause. */
function specifierNames(node) {
    return node.specifiers
        .filter(specifier => specifier.exported.type === 'Identifier' && specifier.exportKind !== 'type')
        .map(specifier => specifier.exported.name);
}

/** Every runtime-value name a program exports. */
function exportedNames(program) {
    const names = new Set();

    for (const node of program.body) {
        if (node.type !== 'ExportNamedDeclaration' || node.exportKind === 'type') {
            continue;
        }

        for (const name of [...declaredNames(node), ...specifierNames(node)]) {
            names.add(name);
        }
    }

    return names;
}

// Stryker disable all: declarative rule metadata
export default createRule({
    name: 'module-export-names',
    meta: {
        type: 'problem',
        docs: {
            description: 'Require each module file to export its canonically named binding.',
        },
        schema: [],
        messages: {
            missing: '{{file}} must export `{{name}}`.',
        },
    },
    defaultOptions: [],
    // Stryker restore all
    create(context) {
        const filename = projectPath(context);
        const folder = moduleFolder(filename);
        const contract = contractFile(filename);

        if (folder === null || contract === null) {
            return {};
        }

        const expected = { name: EXPORT_NAMES[contract.kind](folder), file: contract.file };

        return {
            Program(node) {
                if (!exportedNames(node).has(expected.name)) {
                    context.report({ node, messageId: 'missing', data: expected });
                }
            },
        };
    },
});
