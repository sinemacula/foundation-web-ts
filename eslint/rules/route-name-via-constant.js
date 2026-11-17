/**
 * Require route record names in `routes.ts` to reference a `_ROUTE_NAMES` map.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

// biome-ignore-all lint/style/useNamingConvention: ESLint AST visitor keys

import { contractFile, createRule, projectPath, propertyName, staticString } from './lib.js';

/** Whether an object expression is a route record (carries `path` or `component`). */
function isRouteObject(objectExpression) {
    return objectExpression.properties.some(property => {
        const name = propertyName(property);

        return name === 'path' || name === 'component';
    });
}

/** The nearest ancestor that is not an `as` or `satisfies` wrapper. */
function unwrappedParent(node) {
    let parent = node.parent;

    while (parent.type === 'TSAsExpression' || parent.type === 'TSSatisfiesExpression') {
        parent = parent.parent;
    }

    return parent;
}

const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);

/** The function a return statement returns from. */
function enclosingFunction(node) {
    let current = node.parent;

    while (!FUNCTIONS.has(current.type)) {
        current = current.parent;
    }

    return current;
}

/**
 * Whether an object is a route record's `redirect` location, given directly or
 * returned from a redirect function.
 */
function isRedirectLocation(objectExpression) {
    let holder = unwrappedParent(objectExpression);

    if (holder.type === 'ReturnStatement') {
        holder = enclosingFunction(holder);
    }

    if (FUNCTIONS.has(holder.type)) {
        holder = unwrappedParent(holder);
    }

    return propertyName(holder) === 'redirect' && isRouteObject(holder.parent);
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
        if (contractFile(projectPath(context))?.kind !== 'routes') {
            return {};
        }

        return {
            Property(node) {
                if (propertyName(node) !== 'name' || !(isRouteObject(node.parent) || isRedirectLocation(node.parent))) {
                    return;
                }

                const inline = staticString(node.value);

                if (inline !== null) {
                    context.report({ node: node.value, messageId: 'inline', data: { value: inline } });
                }
            },
        };
    },
});
