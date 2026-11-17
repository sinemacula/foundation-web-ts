/**
 * Forbid snake_case object-literal keys; wire field names go through `wire()`.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

// biome-ignore-all lint/style/useNamingConvention: ESLint AST visitor keys

import { createRule, isTestPath } from './lib.js';

const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/** The static name of a property key (including a computed string literal), or null. */
function keyName(property) {
    // `{ ['refresh_token']: 1 }` still writes a snake_case key.
    if (property.computed) {
        return property.key.type === 'Literal' && typeof property.key.value === 'string' ? property.key.value : null;
    }

    if (property.key.type === 'Identifier') {
        return property.key.name;
    }

    if (property.key.type === 'Literal' && typeof property.key.value === 'string') {
        return property.key.value;
    }

    return null;
}

// Stryker disable all: declarative rule metadata
export default createRule({
    name: 'no-snake-case-keys',
    meta: {
        type: 'problem',
        docs: {
            description: 'Forbid snake_case keys in object-literal construction; route wire fields through wire().',
        },
        schema: [],
        messages: {
            snake: "Object key '{{key}}' is snake_case; map wire fields through wire() instead of a snake_case key.",
        },
    },
    defaultOptions: [],
    // Stryker restore all
    create(context) {
        const filename = context.filename.replace(/\\/g, '/');

        if (isTestPath(filename)) {
            return {};
        }

        return {
            Property(node) {
                if (node.parent?.type !== 'ObjectExpression') {
                    return;
                }

                const name = keyName(node);

                if (name !== null && SNAKE_CASE.test(name)) {
                    context.report({ node: node.key, messageId: 'snake', data: { key: name } });
                }
            },
        };
    },
});
