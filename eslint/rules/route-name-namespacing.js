/**
 * Require `_ROUTE_NAMES` values to read `<folder>.<kebab>`, the i18n namespace.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

// biome-ignore-all lint/style/useNamingConvention: ESLint AST visitor keys

import { createRule, moduleFolder, unwrapExpression } from './lib.js';

/** Escape a string for literal use inside a regular expression. */
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every string or single-quasi template value in an object, recursively.
 */
function routeNameValues(objectExpression) {
    const values = [];

    for (const property of objectExpression.properties) {
        if (property.type !== 'Property') {
            continue;
        }

        const value = property.value;

        if (value.type === 'Literal' && typeof value.value === 'string') {
            values.push({ node: value, text: value.value });
        } else if (value.type === 'TemplateLiteral' && value.expressions.length === 0) {
            values.push({ node: value, text: value.quasis[0].value.cooked });
        } else if (value.type === 'ObjectExpression') {
            values.push(...routeNameValues(value));
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
        const filename = context.filename.replace(/\\/g, '/');

        if (!/(?:^|\/)route-names\.ts$/.test(filename)) {
            return {};
        }

        const folder = moduleFolder(filename);

        if (folder === null) {
            return {};
        }

        const pattern = new RegExp(
            `^${escapeRegExp(folder)}\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$`,
        );

        return {
            VariableDeclarator(node) {
                if (node.id?.type !== 'Identifier' || !/_ROUTE_NAMES$/.test(node.id.name)) {
                    return;
                }

                const object = unwrapExpression(node.init);

                if (object?.type !== 'ObjectExpression') {
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
