/**
 * Require each module contract file to export its folder-derived binding name.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

// biome-ignore-all lint/style/useNamingConvention: ESLint AST visitor keys

import { createRule, moduleFolder, toCamelCase, toUpperSnakeCase } from './lib.js';

/** The canonical export name a module file must declare, or null. */
function expectedExport(filename, folder) {
    if (/(?:^|\/)module\.ts$/.test(filename)) {
        return { name: `${toCamelCase(folder)}Module`, file: 'module.ts' };
    }

    if (/(?:^|\/)routes\.ts$/.test(filename)) {
        return { name: `${toCamelCase(folder)}Routes`, file: 'routes.ts' };
    }

    if (/(?:^|\/)route-names\.ts$/.test(filename)) {
        return { name: `${toUpperSnakeCase(folder)}_ROUTE_NAMES`, file: 'route-names.ts' };
    }

    return null;
}

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
        const filename = context.filename.replace(/\\/g, '/');
        const folder = moduleFolder(filename);

        if (folder === null) {
            return {};
        }

        const expected = expectedExport(filename, folder);

        if (expected === null) {
            return {};
        }

        return {
            Program(node) {
                if (!exportedNames(node).has(expected.name)) {
                    context.report({ node, messageId: 'missing', data: expected });
                }
            },
        };
    },
});
