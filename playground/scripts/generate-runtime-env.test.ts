/**
 * Tests for the runtime-env.json generator, run as the deploy pipeline runs it.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REQUIRED_RUNTIME_KEYS } from '../src/config/runtime';

const SCRIPT = join(import.meta.dirname, 'generate-runtime-env.mjs');

/**
 * Run the script with exactly the given environment and parse its output.
 */
function generate(env: Record<string, string>): Record<string, string> {
    return JSON.parse(execFileSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' })) as Record<string, string>;
}

/**
 * Build an env record from pairs, keeping env-style keys out of object-literal keys.
 */
function wire(entries: ReadonlyArray<readonly [string, string]>): Record<string, string> {
    return Object.fromEntries(entries);
}

describe('generate-runtime-env', () => {
    it('exposes every key a production boot requires', () => {
        const env = Object.fromEntries(REQUIRED_RUNTIME_KEYS.map(key => [key, `${key}-value`]));

        expect(generate(env)).toEqual(env);
    });

    it('omits keys outside the allow-list', () => {
        const output = generate(
            wire([
                ['API_URL', 'https://api.example.com'],
                ['DB_PASSWORD', 'secret'],
                ['AWS_SECRET_ACCESS_KEY', 'secret'],
            ]),
        );

        expect(output).toEqual(wire([['API_URL', 'https://api.example.com']]));
    });

    it('drops allow-listed keys whose value is empty', () => {
        expect(
            generate(
                wire([
                    ['API_URL', ''],
                    ['APP_ENV', 'production'],
                ]),
            ),
        ).toEqual(wire([['APP_ENV', 'production']]));
    });

    it.each([
        ['a space-separated list', 'APP_NAME CUSTOM_KEY'],
        ['a list with surrounding whitespace', '  APP_NAME\n\tCUSTOM_KEY  '],
    ])('replaces the allow-list with RUNTIME_ENV_KEYS given as %s', (_description, keys) => {
        const output = generate(
            wire([
                ['RUNTIME_ENV_KEYS', keys],
                ['APP_NAME', 'Console'],
                ['CUSTOM_KEY', 'custom'],
                ['API_URL', 'https://api.example.com'],
            ]),
        );

        expect(output).toEqual(
            wire([
                ['APP_NAME', 'Console'],
                ['CUSTOM_KEY', 'custom'],
            ]),
        );
    });

    it('falls back to the default allow-list when RUNTIME_ENV_KEYS is blank', () => {
        const output = generate(
            wire([
                ['RUNTIME_ENV_KEYS', '   '],
                ['API_URL', 'https://api.example.com'],
                ['APP_NAME', 'Console'],
            ]),
        );

        expect(output).toEqual(wire([['API_URL', 'https://api.example.com']]));
    });
});
