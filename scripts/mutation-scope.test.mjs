/**
 * Tests for the mutation scope of a change set.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { fullScopeFingerprint, isMutable, mutationScope, parseNameStatus } from './mutation-scope.mjs';

const MUTATE = JSON.parse(readFileSync('stryker.config.json', 'utf8')).mutate;

const TRACKED = [
    'src/app/create-web-core-app.ts',
    'src/app/create-web-core-app.test.ts',
    'src/app/services.ts',
    'src/i18n/locales/en-us.ts',
    'src/session/session-store.ts',
    'src/session/session-store.test.ts',
    'src/session/redirect.ts',
    'src/session/test-support/fake-router.ts',
    'src/session/index.ts',
    'src/router/chunk-error-recovery.ts',
    'playground/src/services/api.ts',
    'playground/src/boot.test.ts',
    'playground/src/main.ts',
    'eslint/rules/no-deep-imports.js',
    'eslint/rules/no-deep-imports.test.js',
    'e2e/specs/auth.spec.ts',
];

/**
 * Compute the scope of `changes` against the fixture repository.
 */
function scopeOf(changes, packagesChanged = false) {
    return mutationScope({ changes, tracked: TRACKED, mutate: MUTATE, packagesChanged });
}

/**
 * Run the command-line entry point with `args`.
 */
function runCli(args) {
    return spawnSync(process.execPath, ['scripts/mutation-scope.mjs', ...args], { encoding: 'utf8' });
}

describe('isMutable', () => {
    it.each([
        ['src/app/services.ts', true],
        ['playground/src/services/api.ts', true],
        ['src/app/services.test.ts', false],
        ['src/session/test-support/fake-router.ts', false],
        ['src/session/index.ts', false],
        ['playground/src/main.ts', false],
        ['src/i18n/locales/en-us.ts', false],
        ['eslint/rules/no-deep-imports.js', false],
        ['e2e/specs/auth.spec.ts', false],
    ])('reads %s as mutable: %s', (path, expected) => {
        expect(isMutable(path, MUTATE)).toBe(expected);
    });
});

describe('mutationScope', () => {
    it.each([
        ['a changed source', [{ path: 'src/app/services.ts' }], ['src/app/services.ts']],
        ['a changed test', [{ path: 'src/session/session-store.test.ts' }], ['src/session/session-store.ts']],
        [
            'a renamed test',
            [{ path: 'src/session/store.test.ts', previous: 'src/session/session-store.test.ts' }],
            ['src/session/redirect.ts', 'src/session/session-store.ts'],
        ],
        ['a deleted test', [{ path: 'src/app/create-web-core-app.test.ts' }], ['src/app/create-web-core-app.ts']],
        [
            'a test with no source of its own',
            [{ path: 'playground/src/boot.test.ts' }],
            ['playground/src/services/api.ts'],
        ],
        [
            'changed test support',
            [{ path: 'src/session/test-support/fake-router.ts' }],
            ['src/session/redirect.ts', 'src/session/session-store.ts'],
        ],
        ['a deleted source', [{ path: 'src/app/removed.ts' }], []],
        ['excluded sources', [{ path: 'src/session/index.ts' }, { path: 'src/i18n/locales/en-us.ts' }], []],
        [
            'files outside the mutated tree',
            [{ path: 'eslint/rules/no-deep-imports.test.js' }, { path: 'e2e/specs/auth.spec.ts' }],
            [],
        ],
        [
            'overlapping changes, sorted once each',
            [{ path: 'src/session/session-store.ts' }, { path: 'src/session/test-support/fake-router.ts' }],
            ['src/session/redirect.ts', 'src/session/session-store.ts'],
        ],
    ])('scopes %s', (_case, changes, expected) => {
        expect(scopeOf(changes)).toEqual(expected);
    });

    it.each(['stryker.config.json', 'vitest.config.ts', 'playground/src/test-support/setup-network-guard.ts'])(
        'mutates everything when %s changes',
        path => {
            expect(scopeOf([{ path }])).toEqual(MUTATE);
        },
    );

    it('mutates everything when the installed Foundation, test runner or mutation engine changes', () => {
        expect(scopeOf([{ path: 'package-lock.json' }], true)).toEqual(MUTATE);
    });
});

describe('fullScopeFingerprint', () => {
    /**
     * Build a lockfile installing Foundation from `resolved` and the test
     * runner and mutation engine at the given versions, beside another package.
     */
    const lockfile = (
        resolved,
        { core = '10.0.0', runner = core, vitest = '5.0.0', mocker = vitest, other = '1.0.0', extra = {} } = {},
    ) => ({
        packages: {
            'node_modules/@sinemacula/foundation': { version: '0.0.0', resolved },
            'node_modules/@stryker-mutator/core': { version: core },
            'node_modules/@stryker-mutator/vitest-runner': { version: runner },
            'node_modules/vitest': { version: vitest },
            'node_modules/@vitest/mocker': { version: mocker },
            'node_modules/vue': { version: other },
            ...extra,
        },
    });

    it('ignores a package whose name only starts with vitest', () => {
        const extra = { 'node_modules/vitest-environment-x': { version: '1.0.0' } };

        expect(fullScopeFingerprint(lockfile('git#a', { extra }))).toBe(fullScopeFingerprint(lockfile('git#a')));
    });

    it('matches lockfiles installing the same Foundation, test runner and mutation engine', () => {
        expect(fullScopeFingerprint(lockfile('git#a', { other: '1.0.0' }))).toBe(
            fullScopeFingerprint(lockfile('git#a', { other: '2.0.0' })),
        );
    });

    it.each([
        ['a different Foundation commit', lockfile('git#b')],
        ['a different engine core', lockfile('git#a', { core: '10.1.0', runner: '10.0.0' })],
        ['a different engine runner', lockfile('git#a', { runner: '10.1.0' })],
        ['a different test runner', lockfile('git#a', { vitest: '5.1.0' })],
        ['a different test runner internal', lockfile('git#a', { mocker: '5.1.0' })],
        [
            'a nested test runner install',
            lockfile('git#a', { extra: { 'node_modules/x/node_modules/vitest': { version: '4.0.0' } } }),
        ],
        ['no lockfile', null],
        ['no Foundation or engine entry', { packages: {} }],
    ])('tells %s apart', (_case, other) => {
        expect(fullScopeFingerprint(other)).not.toBe(fullScopeFingerprint(lockfile('git#a')));
    });
});

describe('parseNameStatus', () => {
    it('reads additions, edits, deletions, renames and copies', () => {
        const output = [
            'A\tsrc/a.ts',
            'M\tsrc/b.ts',
            'D\tsrc/c.ts',
            'R087\tsrc/d.ts\tsrc/e.ts',
            'C100\tsrc/f.ts\tsrc/g.ts',
            '',
        ];

        expect(parseNameStatus(output.join('\n'))).toEqual([
            { path: 'src/a.ts' },
            { path: 'src/b.ts' },
            { path: 'src/c.ts' },
            { path: 'src/e.ts', previous: 'src/d.ts' },
            { path: 'src/g.ts', previous: 'src/f.ts' },
        ]);
    });
});

describe('command line', () => {
    it('prints nothing for no changes', () => {
        const result = runCli(['--base', 'HEAD']);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe('');
    });

    it('fails on a base it cannot resolve', () => {
        const result = runCli(['--base', 'no-such-ref']);

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain("Cannot resolve the base 'no-such-ref'");
    });
});
