/**
 * Tests for the route-name-via-constant rule.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import rule from '../route-name-via-constant.js';
import { ruleTester } from './tester.js';

ruleTester.run('route-name-via-constant', rule, {
    valid: [
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/login', name: AUTH_ROUTE_NAMES.login }];",
        },
        // An inline `title` (not `name`) is fine.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/x', name: NAMES.login, meta: { title: 'auth.login.title' } }];",
        },
        // Not a routes.ts file - ignored (e.g. module.ts declares name inline).
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule = { name: 'auth' };",
        },
        // A sibling whose name merely ends in `routes.ts`.
        {
            filename: 'src/modules/auth/subroutes.ts',
            code: "export const authRoutes = [{ path: '/x', name: 'auth.login' }];",
        },
        // A `name` inside a nested non-route object (a transition).
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/x', name: NAMES.login, meta: { transition: { name: 'fade' } } }];",
        },
        // A computed name key is not a static `name` - left alone.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/x', [dynamic]: 'auth.login' }];",
        },
        // A numeric key is ignored, and a member-expression name is fine.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/x', 5: 'y', name: NAMES.login }];",
        },
        // An interpolated template is not a static name.
        {
            filename: 'src/modules/auth/routes.ts',
            code: `export const authRoutes = [{ path: '/login', name: \`\${NS}.login\` }];`,
        },
        // A constant target, a nested function's return, or no route record.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/', redirect: { name: NAMES.login } }];",
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/', redirect: () => pick(o => { return { name: 'x' }; }) }];",
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/', redirect: () => { function f() { return { name: 'x' }; } return f(); } }];",
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const options = { redirect: { name: 'auth.login' } };",
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/', props: () => ({ name: 'auth.login' }) }];",
        },
        // A bare object with neither path nor component is not a route record.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ name: 'auth.login', meta: {} }];",
        },
    ],
    invalid: [
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/login', name: 'auth.login' }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.login' } }],
        },
        // Backslash (Windows) paths are normalised before the file is matched.
        {
            filename: 'src\\modules\\auth\\routes.ts',
            code: "export const authRoutes = [{ path: '/login', name: 'auth.login' }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.login' } }],
        },
        // A spread sits alongside the inline name on a route record.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ ...base, path: '/login', name: 'auth.login' }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.login' } }],
        },
        // A template-literal inline name.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/login', name: `auth.login` }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.login' } }],
        },
        // Quoted keys resolve the same as identifiers.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ 'path': '/login', 'name': 'auth.login' }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.login' } }],
        },
        // A nested child record.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/a', name: NAMES.a, children: [{ path: 'b', name: 'auth.b' }] }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.b' } }],
        },
        // Redirect locations: direct, asserted, or from a concise arrow.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/', redirect: { name: 'auth.login' } }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.login' } }],
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/', redirect: { name: 'auth.login' } as RouteLocationRaw }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.login' } }],
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/', redirect: { name: 'auth.login' } satisfies RouteLocationRaw }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.login' } }],
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/', redirect: () => ({ name: 'auth.login' }) }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.login' } }],
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/', redirect: to => { if (to) { return { name: 'auth.a' }; } return { name: 'auth.b' }; } }];",
            errors: [
                { messageId: 'inline', data: { value: 'auth.a' } },
                { messageId: 'inline', data: { value: 'auth.b' } },
            ],
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/', redirect() { return { name: 'auth.login' }; } }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.login' } }],
        },
        // Either branch of a conditional redirect.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/', redirect: to => (to.query.x ? { name: 'auth.a' } : { name: 'auth.b' }) }];",
            errors: [
                { messageId: 'inline', data: { value: 'auth.a' } },
                { messageId: 'inline', data: { value: 'auth.b' } },
            ],
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/', redirect: to => { return to ? { name: 'auth.a' } : '/'; } }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.a' } }],
        },
        // An asserted name, a `.tsx` routes file, and one at the root.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ path: '/login', name: 'auth.login' as const }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.login' } }],
        },
        {
            filename: 'src/modules/auth/routes.tsx',
            code: "export const authRoutes = [{ path: '/login', name: 'auth.login' }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.login' } }],
        },
        {
            filename: 'routes.ts',
            code: "export const routes = [{ path: '/login', name: 'auth.login' }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.login' } }],
        },
        // A route record identified by `component` rather than `path`.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const authRoutes = [{ component: LoginView, name: 'auth.login' }];",
            errors: [{ messageId: 'inline', data: { value: 'auth.login' } }],
        },
    ],
});
