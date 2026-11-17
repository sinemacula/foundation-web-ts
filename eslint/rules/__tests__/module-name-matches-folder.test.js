/**
 * Tests for the module-name-matches-folder rule.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import rule from '../module-name-matches-folder.js';
import { ruleTester } from './tester.js';

ruleTester.run('module-name-matches-folder', rule, {
    valid: [
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule: ModuleDefinition = { name: 'auth', routes: [] };",
        },
        {
            filename: 'app/modules/users/module.ts',
            code: "const usersModule: ModuleDefinition = { name: 'users' }; export { usersModule };",
        },
        // Not a module.ts file - ignored.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "const authRoutes: RouteRecordRaw[] = [{ name: 'auth.login' }];",
        },
        // A sibling whose name merely ends in `module.ts`.
        {
            filename: 'src/modules/auth/submodule.ts',
            code: "export const authModule: ModuleDefinition = { name: 'login' };",
        },
        // Not typed as a ModuleDefinition - module-export-names covers it.
        {
            filename: 'src/modules/auth/module.ts',
            code: "const config = { name: 'anything' };",
        },
        // `satisfies` a different type is not a module declaration.
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule = { name: 'login' } satisfies Record<string, string>;",
        },
        // Directly under modules/, so no folder to match against.
        {
            filename: 'src/modules/module.ts',
            code: "export const anyModule: ModuleDefinition = { name: 'whatever' };",
        },
        // Matching name via the idiomatic assertion forms.
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule = { name: 'auth' } satisfies ModuleDefinition;",
        },
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule: ModuleDefinition = { name: 'auth' } as const;",
        },
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule: core.ModuleDefinition = { name: 'auth' };",
        },
        // Declared but not initialised - nothing to inspect, so no report.
        {
            filename: 'src/modules/auth/module.ts',
            code: 'let authModule: ModuleDefinition;',
        },
        // No type, no initialiser - not a module declaration.
        {
            filename: 'src/modules/auth/module.ts',
            code: 'let plain;',
        },
        // Value is not an object literal (built elsewhere) - out of scope.
        {
            filename: 'src/modules/auth/module.ts',
            code: 'export const authModule: ModuleDefinition = buildModule();',
        },
        // No `name` property to check.
        {
            filename: 'src/modules/auth/module.ts',
            code: 'export const authModule: ModuleDefinition = { routes: [] };',
        },
        // `name` is a reference, not a literal - not statically checkable.
        {
            filename: 'src/modules/auth/module.ts',
            code: 'export const authModule: ModuleDefinition = { name: folderName };',
        },
        // `name` is a non-string literal - not a folder name.
        {
            filename: 'src/modules/auth/module.ts',
            code: 'export const authModule: ModuleDefinition = { name: 123 };',
        },
        // A computed key is skipped; a quoted `name` key is still read.
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule: ModuleDefinition = { [dynamic]: 1, 'name': 'auth' };",
        },
        // Other keys, quoted or not, are never mistaken for `name`.
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule: ModuleDefinition = { label: 'Auth', 'title': 'x', name: 'auth' };",
        },
        // A nested module tree is matched against its innermost folder.
        {
            filename: 'src/modules/admin/modules/users/module.ts',
            code: "export const usersModule: ModuleDefinition = { name: 'users' };",
        },
    ],
    invalid: [
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule: ModuleDefinition = { name: 'login', routes: [] };",
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
        {
            filename: 'src/modules/dashboard/module.ts',
            code: "const dashboardModule: ModuleDefinition = { name: 'dash' }; export { dashboardModule };",
            errors: [{ messageId: 'mismatch', data: { folder: 'dashboard', name: 'dash' } }],
        },
        // Backslash (Windows) paths are normalised before the folder is read.
        {
            filename: 'src\\modules\\auth\\module.ts',
            code: "export const authModule: ModuleDefinition = { name: 'login' };",
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
        // The name is found after other properties, and under a quoted key.
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule: ModuleDefinition = { routes: authRoutes, name: 'login' };",
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule: ModuleDefinition = { 'name': 'login' };",
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
        // Computed static keys and asserted or template values are static.
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule: ModuleDefinition = { ['name']: 'login' };",
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule: ModuleDefinition = { name: 'login' as const };",
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
        {
            filename: 'src/modules/auth/module.ts',
            code: 'export const authModule: ModuleDefinition = { name: `login` };',
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
        // The type is read at any wrapper layer, through a frozen object.
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule = ({ name: 'login' } satisfies ModuleDefinition) as const;",
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule = Object.freeze({ name: 'login' } satisfies ModuleDefinition);",
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
        // A `.tsx` module definition is a contract file too.
        {
            filename: 'src/modules/auth/module.tsx',
            code: "export const authModule: ModuleDefinition = { name: 'login' };",
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
        // A spread sits alongside the mismatched name.
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule: ModuleDefinition = { ...defaults, name: 'login' };",
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
        // satisfies / as / as const / qualified type.
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule = { name: 'login' } satisfies ModuleDefinition;",
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule = { name: 'login' } as ModuleDefinition;",
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule: ModuleDefinition = { name: 'login' } as const;",
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
        {
            filename: 'src/modules/auth/module.ts',
            code: "export const authModule: core.ModuleDefinition = { name: 'login' };",
            errors: [{ messageId: 'mismatch', data: { folder: 'auth', name: 'login' } }],
        },
    ],
});
