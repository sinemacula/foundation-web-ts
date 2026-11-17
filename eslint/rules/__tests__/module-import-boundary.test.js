/**
 * Tests for the module-import-boundary rule.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import rule from '../module-import-boundary.js';
import { ruleTester } from './tester.js';

ruleTester.run('module-import-boundary', rule, {
    valid: [
        // The kernel packages are reached by subpath.
        { filename: 'src/app.ts', code: "import { httpClient } from '@sinemacula/web-core/http/client';" },
        { filename: 'src/app.ts', code: "import { Environment } from '@sinemacula/foundation/config/environment';" },
        // Another module is reached through its public surface.
        { filename: 'src/modules/auth/module.ts', code: "import { usersModule } from '@/modules/users';" },
        // A module freely imports its OWN internals.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "import { useLoginForm } from '@/modules/auth/composables/use-login-form';",
        },
        // Ordinary package and relative imports are untouched.
        { filename: 'src/app.ts', code: "import { defineComponent } from 'vue';" },
        { filename: 'src/modules/auth/routes.ts', code: "import { helper } from './helper';" },
        // A local re-export carries no source to inspect.
        { filename: 'src/modules/auth/module.ts', code: 'const thing = 1; export { thing };' },
        // A dynamic import of a computed specifier is not a static path.
        { filename: 'src/modules/auth/routes.ts', code: 'export const load = () => import(chunkPath);' },
        // A dynamic import of own internals is fine.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const load = () => import('@/modules/auth/views/login-view.vue');",
        },
        // Test files may reach across boundaries to assert internals.
        {
            filename: 'src/modules/users/__tests__/registry.test.ts',
            code: "import { secret } from '@/modules/auth/composables/use-login-form';",
        },
        {
            filename: 'src/modules/users/registry.spec.ts',
            code: "import { pkg } from '@sinemacula/web-core';",
        },
        // Backslash (Windows) paths resolve the own module and test folder.
        {
            filename: 'C:\\repo\\src\\modules\\auth\\routes.ts',
            code: "import { useLoginForm } from '@/modules/auth/composables/use-login-form';",
        },
        {
            filename: 'src\\modules\\users\\__tests__\\fixtures.ts',
            code: "import { secret } from '@/modules/auth/composables/use-login-form';",
        },
        // Relative imports within the own module, or out of the module tree.
        { filename: 'src/modules/auth/routes.ts', code: "import { x } from './composables/use-login-form';" },
        { filename: 'src/modules/auth/views/login.ts', code: "import { x } from '../composables/use-login-form';" },
        { filename: 'src/modules/auth/routes.ts', code: "import { x } from '../../shared/format';" },
        { filename: 'src/modules/auth/routes.ts', code: "import { modules } from '../index';" },
        {
            filename: 'src/modules/admin/modules/auth/routes.ts',
            code: "import { x } from '@/modules/admin/modules/auth/composables/use-thing';",
        },
        // A package path through a `modules` folder is not a module tree.
        { filename: 'src/app.ts', code: "import 'some-package/modules/forms/input';" },
        // A trailing slash still names the public surface.
        { filename: 'src/modules/auth/routes.ts', code: "import { x } from '@/modules/users/';" },
        { filename: 'src/modules/auth/routes.ts', code: "import { x } from '../users/';" },
        // An explicit index entry is the public surface too.
        { filename: 'src/modules/auth/routes.ts', code: "import { x } from '@/modules/users/index';" },
        { filename: 'src/modules/auth/routes.ts', code: "import { x } from '../users/index.ts';" },
        // Code outside any module composes module definitions.
        { filename: 'src/modules/index.ts', code: "import { authModule } from './auth/module';" },
        { filename: 'src/app.ts', code: "import { authModule } from '@/modules/auth/module.ts';" },
        // An interpolated dynamic import has no static target.
        {
            filename: 'src/modules/auth/routes.ts',
            code: `export const load = page => import(\`@/modules/users/views/\${page}.vue\`);`,
        },
    ],
    invalid: [
        // Neither bare package barrel is ever imported.
        {
            filename: 'src/app.ts',
            code: "import { httpClient } from '@sinemacula/web-core';",
            errors: [{ messageId: 'barrel' }],
        },
        {
            filename: 'src/app.ts',
            code: "import { Environment } from '@sinemacula/foundation';",
            errors: [{ messageId: 'barrel' }],
        },
        // Reaching into another module's internals.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "import { thing } from '@/modules/users/composables/use-thing';",
            errors: [{ messageId: 'crossModule', data: { module: 'users' } }],
        },
        // A non-module file reaching into a module's internals.
        {
            filename: 'src/app.ts',
            code: "import { thing } from '@/modules/users/composables/use-thing';",
            errors: [{ messageId: 'crossModule', data: { module: 'users' } }],
        },
        // Relative imports resolve to the module they land in.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "import { thing } from '../users/composables/use-thing';",
            errors: [{ messageId: 'crossModule', data: { module: 'users' } }],
        },
        {
            filename: 'src/app.ts',
            code: "import { thing } from './modules/users/composables/use-thing';",
            errors: [{ messageId: 'crossModule', data: { module: 'users' } }],
        },
        {
            filename: 'C:\\repo\\src\\modules\\auth\\views\\login.ts',
            code: "import { thing } from '../../users/composables/use-thing';",
            errors: [{ messageId: 'crossModule', data: { module: 'users' } }],
        },
        // Another module's definition or a nested index is not its surface.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "import { usersModule } from '../users/module';",
            errors: [{ messageId: 'crossModule', data: { module: 'users' } }],
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: "import { x } from '@/modules/users/views/index';",
            errors: [{ messageId: 'crossModule', data: { module: 'users' } }],
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: "import { x } from '@/modules/users/index-helpers';",
            errors: [{ messageId: 'crossModule', data: { module: 'users' } }],
        },
        // Only the definition file itself is open to code outside any module.
        {
            filename: 'src/app.ts',
            code: "import { x } from '@/modules/auth/submodule';",
            errors: [{ messageId: 'crossModule', data: { module: 'auth' } }],
        },
        {
            filename: 'src/app.ts',
            code: "import { x } from '@/modules/auth/module-helpers';",
            errors: [{ messageId: 'crossModule', data: { module: 'auth' } }],
        },
        // A nested module tree is its own module, even under a reused name.
        {
            filename: 'src/modules/admin/views/panel.ts',
            code: "import { x } from '@/modules/admin/modules/users/composables/use-thing';",
            errors: [{ messageId: 'crossModule', data: { module: 'users' } }],
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: "import { x } from '@/modules/admin/modules/auth/composables/use-thing';",
            errors: [{ messageId: 'crossModule', data: { module: 'auth' } }],
        },
        // Type-only imports cross the same boundaries.
        {
            filename: 'src/app.ts',
            code: "import type { HttpClient } from '@sinemacula/web-core';",
            errors: [{ messageId: 'barrel' }],
        },
        {
            filename: 'src/modules/auth/routes.ts',
            code: "import type { User } from '@/modules/users/types';",
            errors: [{ messageId: 'crossModule', data: { module: 'users' } }],
        },
        // A backtick dynamic import is as static as a quoted one.
        {
            filename: 'src/modules/auth/routes.ts',
            code: 'export const load = () => import(`@/modules/users/views/list-view.vue`);',
            errors: [{ messageId: 'crossModule', data: { module: 'users' } }],
        },
        // Dynamic import, re-export and star re-export.
        {
            filename: 'src/modules/auth/routes.ts',
            code: "export const load = () => import('@/modules/users/views/list-view.vue');",
            errors: [{ messageId: 'crossModule', data: { module: 'users' } }],
        },
        {
            filename: 'src/modules/auth/module.ts',
            code: "export { thing } from '@/modules/users/composables/use-thing';",
            errors: [{ messageId: 'crossModule', data: { module: 'users' } }],
        },
        {
            filename: 'src/modules/auth/module.ts',
            code: "export * from '@/modules/users/composables/use-thing';",
            errors: [{ messageId: 'crossModule', data: { module: 'users' } }],
        },
        {
            filename: 'src/modules/auth/module.ts',
            code: "export { httpClient } from '@sinemacula/web-core';",
            errors: [{ messageId: 'barrel' }],
        },
    ],
});

describe('module-import-boundary in a checkout beneath a modules folder', () => {
    it('reads module trees from the working directory down', () => {
        const linter = new Linter({ cwd: '/home/me/modules/app' });
        const plugin = { rules: { boundary: rule } };
        const config = [{ files: ['**/*.ts'], plugins: { local: plugin }, rules: { 'local/boundary': 'error' } }];
        const messages = linter.verify("import { x } from '@/modules/app/internal';", config, {
            filename: '/home/me/modules/app/src/app.ts',
        });

        expect(messages.map(message => message.messageId)).toEqual(['crossModule']);
    });
});
