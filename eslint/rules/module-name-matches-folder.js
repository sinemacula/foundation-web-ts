/**
 * Require a module's declared name (its i18n namespace) to match its folder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

// biome-ignore-all lint/style/useNamingConvention: ESLint AST visitor keys

import {
    contractFile,
    createRule,
    expressionLayers,
    moduleFolder,
    objectLiteral,
    projectPath,
    propertyName,
    staticString,
    typeReferenceName,
} from './lib.js';

/**
 * Whether a declarator is typed `ModuleDefinition` (or `ns.ModuleDefinition`)
 * by annotation, or by an `as` or `satisfies` at any wrapper layer.
 */
function declaresModule(node) {
    if (typeReferenceName(node.id.typeAnnotation?.typeAnnotation) === 'ModuleDefinition') {
        return true;
    }

    return expressionLayers(node.init).some(layer => typeReferenceName(layer.typeAnnotation) === 'ModuleDefinition');
}

// Stryker disable all: declarative rule metadata
export default createRule({
    name: 'module-name-matches-folder',
    meta: {
        type: 'problem',
        docs: {
            description: "Require a module's declared name to match its folder.",
        },
        schema: [],
        messages: {
            mismatch: "This module lives in '{{folder}}' but declares name '{{name}}'; they must match.",
        },
    },
    defaultOptions: [],
    // Stryker restore all
    create(context) {
        const filename = projectPath(context);
        const folder = moduleFolder(filename);

        if (contractFile(filename)?.kind !== 'module' || folder === null) {
            return {};
        }

        return {
            VariableDeclarator(node) {
                if (!declaresModule(node)) {
                    return;
                }

                const object = objectLiteral(node.init);
                const nameProperty = object?.properties.find(property => propertyName(property) === 'name');
                const name = staticString(nameProperty?.value);

                if (name !== null && name !== folder) {
                    context.report({ node: nameProperty.value, messageId: 'mismatch', data: { folder, name } });
                }
            },
        };
    },
});
