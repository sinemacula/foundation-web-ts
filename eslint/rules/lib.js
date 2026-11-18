/**
 * Shared helpers for the foundation-web ESLint rules.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import path from 'node:path';
import { ESLintUtils } from '@typescript-eslint/utils';

/** Shared rule factory linking each rule to its README section. */
export const createRule = ESLintUtils.RuleCreator(name => `https://github.com/sinemacula/foundation-web-ts#${name}`);

const CONTRACT_FILE = /(?:^|\/)(?<file>(?<kind>module|routes|route-names)\.tsx?)$/;

/**
 * The linted file's path relative to the working directory, with forward
 * slashes, so folders above the project never read as a module tree.
 */
export function projectPath(context) {
    return path.relative(context.cwd, path.resolve(context.cwd, context.filename)).replace(/\\/g, '/');
}

/**
 * The module contract file a path names, as its basename (`file`) and `kind`
 * (`module`, `routes` or `route-names`, in `.ts` or `.tsx`), or null.
 */
export function contractFile(filename) {
    return CONTRACT_FILE.exec(filename)?.groups ?? null;
}

/** Whether a project path marks the file as test code or a test-only helper. */
export function isTestPath(filename) {
    return (
        /(?:^|\/)(?:__tests__|__mocks__|test-support)\//.test(filename) ||
        /\.(?:test|spec)(?:-d)?\.[cm]?[jt]sx?$/.test(filename)
    );
}

/**
 * Where a path sits in its innermost module tree: the module `id` (the folder
 * after every `modules/`, so nested modules stay distinct), its innermost
 * `folder` and the `entry` path inside it, or null outside a module tree or for
 * a path directly under `modules/`.
 */
export function moduleLocation(filename) {
    const parts = filename.split('/').filter(part => part !== '');
    const index = parts.lastIndexOf('modules');

    if (index < 0 || index + 2 >= parts.length) {
        return null;
    }

    const id = parts.filter((_, position) => parts[position - 1] === 'modules').join('/');

    return { id, folder: parts[index + 1], entry: parts.slice(index + 2).join('/') };
}

/** The folder of a path's innermost module tree, or null (see moduleLocation). */
export function moduleFolder(filename) {
    return moduleLocation(filename)?.folder ?? null;
}

/** Whether a node is an `Object.freeze(x)` call with a single argument. */
function isFreezeCall(node) {
    const callee = node.callee;

    if (node.type !== 'CallExpression' || callee.type !== 'MemberExpression' || callee.computed) {
        return false;
    }

    return node.arguments.length === 1 && callee.object.name === 'Object' && callee.property.name === 'freeze';
}

/** The expression one `as`, `satisfies` or `Object.freeze()` layer wraps, or null. */
function innerExpression(node) {
    if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression') {
        return node.expression;
    }

    return isFreezeCall(node) ? node.arguments[0] : null;
}

/** Each layer of an expression, from the outermost wrapper inward. */
export function expressionLayers(node) {
    const layers = [];

    for (let current = node; current; current = innerExpression(current)) {
        layers.push(current);
    }

    return layers;
}

/**
 * Strip `as`, `satisfies` and `Object.freeze()` wrappers off a node.
 */
function unwrapExpression(node) {
    return expressionLayers(node).at(-1) ?? null;
}

/** The object literal a node holds beneath any wrappers, or null. */
export function objectLiteral(node) {
    const inner = unwrapExpression(node);

    return inner?.type === 'ObjectExpression' ? inner : null;
}

/**
 * The text of a string literal or interpolation-free template beneath any
 * wrappers, or null.
 */
export function staticString(node) {
    const inner = unwrapExpression(node);

    if (inner?.type === 'Literal' && typeof inner.value === 'string') {
        return inner.value;
    }

    if (inner?.type === 'TemplateLiteral' && inner.expressions.length === 0) {
        return inner.quasis[0].value.cooked;
    }

    return null;
}

/**
 * The static key a property writes (an identifier, a string, or a computed
 * string or template), or null for spreads and dynamic keys.
 */
export function propertyName(property) {
    if (property.type !== 'Property') {
        return null;
    }

    if (!property.computed && property.key.type === 'Identifier') {
        return property.key.name;
    }

    return staticString(property.key);
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
