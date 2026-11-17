/**
 * Require `_ROUTE_NAMES` values to read `<folder>.<kebab>`, the i18n namespace.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

// biome-ignore-all lint/style/useNamingConvention: ESLint AST visitor keys

import { contractFile, createRule, moduleFolder, objectLiteral, projectPath, staticString } from './lib.js';

/** Escape a string for literal use inside a regular expression. */
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every static string value in an object, walking nested groups.
 */
function routeNameValues(objectExpression) {
    const values = [];

    for (const property of objectExpression.properties) {
        const text = staticString(property.value);
        const group = objectLiteral(property.value);

        if (text !== null) {
            values.push({ node: property.value, text });
        } else if (group !== null) {
            values.push(...routeNameValues(group));
        }
    }

    return values;
}

// Stryker disable all: declarative rule metadata
export default createRule({
    name: 'route-name-namespacing',
    meta: {
        type: 'problem',
        docs: {
            description: 'Require route names to be namespaced under the module folder.',
        },
        schema: [],
        messages: {
            unnamespaced: "Route name '{{value}}' must be namespaced as '{{folder}}.<kebab>'.",
        },
    },
    defaultOptions: [],
    // Stryker restore all
    create(context) {
        const filename = projectPath(context);
        const folder = moduleFolder(filename);

        if (contractFile(filename)?.kind !== 'route-names' || folder === null) {
            return {};
        }

        const pattern = new RegExp(
            `^${escapeRegExp(folder)}\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$`,
        );

        return {
            VariableDeclarator(node) {
                if (node.id.type !== 'Identifier' || !/_ROUTE_NAMES$/.test(node.id.name)) {
                    return;
                }

                const object = objectLiteral(node.init);

                if (object === null) {
                    return;
                }

                for (const { node: literal, text } of routeNameValues(object)) {
                    if (!pattern.test(text)) {
                        context.report({
                            node: literal,
                            messageId: 'unnamespaced',
                            data: { value: text, folder },
                        });
                    }
                }
            },
        };
    },
});
