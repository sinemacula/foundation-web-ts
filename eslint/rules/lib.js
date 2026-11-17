/**
 * Shared helpers for the web-core ESLint rules.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { ESLintUtils } from '@typescript-eslint/utils';

/** Shared rule factory linking each rule to its documentation anchor. */
// Stryker disable next-line all: documentation anchor
export const createRule = ESLintUtils.RuleCreator(name => `https://github.com/sinemacula/web-core-ts#${name}`);

/** Whether the file path marks it as test code. */
export function isTestPath(filename) {
    const path = filename.replace(/\\/g, '/');

    return path.includes('/__tests__/') || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

/**
 * The segment after `modules/` in a file path, or null outside a module tree or
 * for a file directly under `modules/`.
 */
export function moduleFolder(filename) {
    const parts = filename.replace(/\\/g, '/').split('/');
    const index = parts.lastIndexOf('modules');

    if (index < 0 || index + 2 >= parts.length || !parts[index + 1]) {
        return null;
    }

    return parts[index + 1];
}

/**
 * Strip `as` / `satisfies` wrappers (`x as const satisfies T`) off a node.
 */
export function unwrapExpression(node) {
    let current = node;

    while (current?.type === 'TSAsExpression' || current?.type === 'TSSatisfiesExpression') {
        current = current.expression;
    }

    return current ?? null;
}

/**
 * The rightmost identifier name of a type reference (`T` or `ns.T` both yield
 * `T`), or null when the annotation is not a plain type reference.
 */
export function typeReferenceName(annotation) {
    const typeName = annotation?.typeName;

    if (typeName?.type === 'Identifier') {
        return typeName.name;
    }

    if (typeName?.type === 'TSQualifiedName') {
        return typeName.right.name;
    }

    return null;
}

/**
 * Convert a kebab-case name to camelCase (`user-settings` -> `userSettings`).
 */
export function toCamelCase(kebab) {
    return kebab.replace(/-([a-z0-9])/g, (_, character) => character.toUpperCase());
}

/**
 * Convert a kebab-case name to UPPER_SNAKE_CASE (`user-settings` ->
 * `USER_SETTINGS`).
 */
export function toUpperSnakeCase(kebab) {
    return kebab.replace(/-/g, '_').toUpperCase();
}
