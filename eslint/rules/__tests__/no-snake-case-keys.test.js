/**
 * Tests for the no-snake-case-keys rule.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import rule from '../no-snake-case-keys.js';
import { ruleTester } from './tester.js';

ruleTester.run('no-snake-case-keys', rule, {
    valid: [
        // wire() is the sanctioned path - no snake_case key.
        { filename: 'src/http/client.ts', code: "const body = wire([['refresh_token', token]]);" },
        // Destructuring an external payload is fine.
        { filename: 'src/http/client.ts', code: 'const { refresh_token } = response;' },
        // Declaring a type that models an external shape is fine.
        { filename: 'src/http/client.ts', code: 'interface Auth { refresh_token: string; }' },
        // camelCase keys are fine.
        { filename: 'src/http/client.ts', code: 'const o = { refreshToken: 1, userId: 2 };' },
        // A computed key from a variable, even one named in snake_case.
        { filename: 'src/http/client.ts', code: 'const o = { [field]: 1 };' },
        { filename: 'src/http/client.ts', code: 'const o = { [refresh_token]: 1 };' },
        // A non-string (numeric) key is not a snake_case key.
        { filename: 'src/http/client.ts', code: 'const o = { 42: 1 };' },
        // Leading-underscore markers and mixed case are not snake_case.
        { filename: 'src/http/client.ts', code: 'const o = { __v_skip: true, foo_Bar: 1, foo_barBaz: 2 };' },
        // Test files are exempt.
        { filename: 'src/http/client.test.ts', code: 'const o = { refresh_token: 1 };' },
        { filename: 'src/http/client.test.mts', code: 'const o = { refresh_token: 1 };' },
        { filename: 'src/http/client.spec.cts', code: 'const o = { refresh_token: 1 };' },
        { filename: 'src\\http\\__tests__\\fixtures.ts', code: 'const o = { refresh_token: 1 };' },
        // Type tests, mocks and test-only helper folders are test code too.
        { filename: 'src/http/client.test-d.ts', code: 'const o = { refresh_token: 1 };' },
        { filename: 'src/http/__mocks__/client.ts', code: 'const o = { refresh_token: 1 };' },
        { filename: 'src/session/test-support/payloads.ts', code: 'const o = { refresh_token: 1 };' },
        { filename: 'test-support/payloads.ts', code: 'const o = { refresh_token: 1 };' },
    ],
    invalid: [
        {
            filename: 'src/http/client.ts',
            code: 'const o = { refresh_token: 1 };',
            errors: [{ messageId: 'snake', data: { key: 'refresh_token' } }],
        },
        {
            filename: 'src/http/client.ts',
            code: "const o = { 'created_at': 1 };",
            errors: [{ messageId: 'snake', data: { key: 'created_at' } }],
        },
        {
            filename: 'src/http/client.ts',
            code: 'const o = { token_expires_at: 1 };',
            errors: [{ messageId: 'snake', data: { key: 'token_expires_at' } }],
        },
        // A computed string-literal key.
        {
            filename: 'src/http/client.ts',
            code: "const o = { ['refresh_token']: 1 };",
            errors: [{ messageId: 'snake', data: { key: 'refresh_token' } }],
        },
        {
            filename: 'src/http/client.ts',
            code: 'const o = { [`refresh_token`]: 1 };',
            errors: [{ messageId: 'snake', data: { key: 'refresh_token' } }],
        },
        // Only whole folder names mark test-only helpers.
        {
            filename: 'src/my-test-support/payloads.ts',
            code: 'const o = { refresh_token: 1 };',
            errors: [{ messageId: 'snake', data: { key: 'refresh_token' } }],
        },
    ],
});
