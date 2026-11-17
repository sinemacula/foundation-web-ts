/**
 * Forbid snake_case object-literal keys; wire field names go through `wire()`.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

// biome-ignore-all lint/style/useNamingConvention: ESLint AST visitor keys

import { createRule, isTestPath, projectPath, propertyName } from './lib.js';

const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

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
        if (isTestPath(projectPath(context))) {
            return {};
        }

        return {
            Property(node) {
                if (node.parent.type !== 'ObjectExpression') {
                    return;
                }

                const name = propertyName(node);

                if (name !== null && SNAKE_CASE.test(name)) {
                    context.report({ node: node.key, messageId: 'snake', data: { key: name } });
                }
            },
        };
    },
});
