/**
 * Tests for the module-export-names rule.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import rule from '../module-export-names.js';
import { ruleTester } from './tester.js';

ruleTester.run('module-export-names', rule, {
    valid: [
        {
            filename: 'src/modules/auth/module.ts',
            code: 'export const authModule: ModuleDefinition = { name: "auth" };',
        },
        {
            filename: 'src/modules/user-settings/routes.ts',
            code: 'export const userSettingsRoutes: readonly RouteRecordRaw[] = [];',
        },
        {
            filename: 'src/modules/auth/route-names.ts',
            code: 'export const AUTH_ROUTE_NAMES = { login: "auth.login" } as const;',
        },
        {
            filename: 'src/modules/user-settings/route-names.ts',
            code: 'const USER_SETTINGS_ROUTE_NAMES = {} as const; export { USER_SETTINGS_ROUTE_NAMES };',
        },
        // Not one of the contract files - ignored.
        {
            filename: 'src/modules/auth/composables/use-login-form.ts',
            code: 'export const anything = 1;',
        },
        // A sibling whose name merely ends in a contract name.
        {
            filename: 'src/modules/auth/submodule.ts',
            code: 'export const whatever = 1;',
        },
        // Directly under modules/, so no folder to derive a name from.
        {
            filename: 'src/modules/module.ts',
            code: 'export const anyModule = {};',
        },
        // A contract basename outside a module tree, or with no module folder.
        { filename: 'src/routes.ts', code: 'export const anything = 1;' },
        { filename: 'modules/module.ts', code: 'export const anything = 1;' },
        // A type-only re-export alongside the runtime value export is fine.
        {
            filename: 'src/modules/auth/module.ts',
            code: 'export type { AuthModule } from "./types"; export const authModule: ModuleDefinition = { name: "auth" };',
        },
    ],
    invalid: [
        {
            filename: 'src/modules/auth/module.ts',
            code: 'export const authModuleDefinition: ModuleDefinition = { name: "auth" };',
            errors: [{ messageId: 'missing', data: { name: 'authModule', file: 'module.ts' } }],
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: 'export const routes: readonly RouteRecordRaw[] = [];',
            errors: [{ messageId: 'missing', data: { name: 'authRoutes', file: 'routes.ts' } }],
        },
        {
            filename: 'src/modules/auth/route-names.ts',
            code: 'export const AUTH_ROUTES = {} as const;',
            errors: [{ messageId: 'missing', data: { name: 'AUTH_ROUTE_NAMES', file: 'route-names.ts' } }],
        },
        // Backslash (Windows) paths are normalised before the folder is read.
        {
            filename: 'src\\modules\\user-settings\\module.ts',
            code: 'export const wrong = 1;',
            errors: [{ messageId: 'missing', data: { name: 'userSettingsModule', file: 'module.ts' } }],
        },
        // `.tsx` contract files carry the same obligation.
        {
            filename: 'src/modules/auth/routes.tsx',
            code: 'export const routes = [];',
            errors: [{ messageId: 'missing', data: { name: 'authRoutes', file: 'routes.tsx' } }],
        },
        // A module tree at the path root.
        {
            filename: 'modules/auth/module.ts',
            code: 'export const wrong = 1;',
            errors: [{ messageId: 'missing', data: { name: 'authModule', file: 'module.ts' } }],
        },
        // Contract basenames are matched anywhere beneath the module folder.
        {
            filename: 'src/modules/auth/locales/routes.ts',
            code: 'export default {};',
            errors: [{ messageId: 'missing', data: { name: 'authRoutes', file: 'routes.ts' } }],
        },
        // A destructured export does not bind a plain name.
        {
            filename: 'src/modules/auth/module.ts',
            code: 'export const { authModule } = registry;',
            errors: [{ messageId: 'missing', data: { name: 'authModule', file: 'module.ts' } }],
        },
        // A type-only export names no runtime binding.
        {
            filename: 'src/modules/auth/module.ts',
            code: 'export type { authModule } from "./internal";',
            errors: [{ messageId: 'missing', data: { name: 'authModule', file: 'module.ts' } }],
        },
        // An inline `type` specifier is not a value export.
        {
            filename: 'src/modules/auth/module.ts',
            code: 'type authModule = number; export { type authModule };',
            errors: [{ messageId: 'missing', data: { name: 'authModule', file: 'module.ts' } }],
        },
    ],
});
