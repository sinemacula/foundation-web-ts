/**
 * Require route record names in `routes.ts` to reference a `_ROUTE_NAMES` map.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

// biome-ignore-all lint/style/useNamingConvention: ESLint AST visitor keys

import { createRule } from './lib.js';

/** The static name of a non-computed property key, or null. */
function keyName(property) {
    if (property.type !== 'Property' || property.computed) {
        return null;
    }

    if (property.key.type === 'Identifier') {
        return property.key.name;
    }

    if (property.key.type === 'Literal' && typeof property.key.value === 'string') {
        return property.key.value;
    }

    return null;
}

/** Whether an object expression is a route record (carries `path` or `component`). */
function isRouteObject(objectExpression) {
    return objectExpression.properties.some(property => {
        const name = keyName(property);

        return name === 'path' || name === 'component';
    });
}

/** The string or single-quasi template a value carries, or null. */
function inlineName(value) {
    if (value.type === 'Literal' && typeof value.value === 'string') {
        return value.value;
    }

    if (value.type === 'TemplateLiteral' && value.expressions.length === 0) {
        return value.quasis[0].value.cooked;
    }

    return null;
}

// Stryker disable all: declarative rule metadata
export default createRule({
    name: 'route-name-via-constant',
    meta: {
        type: 'problem',
        docs: {
            description: 'Require route names to reference a _ROUTE_NAMES constant, not an inline string.',
        },
        schema: [],
        messages: {
            inline: "Reference a _ROUTE_NAMES constant instead of the inline route name '{{value}}'.",
        },
    },
    defaultOptions: [],
    // Stryker restore all
    create(context) {
        const filename = context.filename.replace(/\\/g, '/');

        if (!/(?:^|\/)routes\.ts$/.test(filename)) {
            return {};
        }

        return {
            Property(node) {
                if (
                    keyName(node) !== 'name' ||
                    node.parent?.type !== 'ObjectExpression' ||
                    !isRouteObject(node.parent)
                ) {
                    return;
                }

                const inline = inlineName(node.value);

                if (inline !== null) {
                    context.report({ node: node.value, messageId: 'inline', data: { value: inline } });
                }
            },
        };
    },
});
