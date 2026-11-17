/**
 * Print the mutation scope of the changes since `--base <ref>`, one path or
 * glob per line: the changed sources, the sources behind changed tests and test
 * support, or every `mutate` entry when a change can alter them all.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Files whose change can alter the outcome of every mutant. */
const FULL_SCOPE_TRIGGERS = [
    'stryker.config.json',
    'vitest.config.ts',
    'playground/src/test-support/setup-network-guard.ts',
];

const TEST_FILE = /\.test\.ts$/u;
const TEST_SUPPORT = '/test-support/';
const FOUNDATION_ENTRY = /(?:^|\/)node_modules\/@sinemacula\/foundation$/u;

/**
 * A failure that leaves the scope unknown, so nothing may be printed.
 */
class MutationScopeError extends Error {}

/**
 * Whether a repo-relative POSIX path matches the `mutate` patterns, read as a
 * union of the positive globs minus every `!` exclusion.
 */
export function isMutable(path, mutate) {
    const included = mutate.filter(pattern => !pattern.startsWith('!'));
    const excluded = mutate.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1));

    return (
        included.some(pattern => matchesGlob(path, pattern)) && !excluded.some(pattern => matchesGlob(path, pattern))
    );
}

/**
 * Serialise the installed Foundation entries of a parsed lockfile, so two
 * lockfiles compare equal exactly when they install the same Foundation.
 */
export function foundationFingerprint(lockfile) {
    const packages = lockfile?.packages ?? {};

    return JSON.stringify(
        Object.keys(packages)
            .filter(key => FOUNDATION_ENTRY.test(key))
            .sort()
            .map(key => [key, packages[key].version ?? null, packages[key].resolved ?? null]),
    );
}

/**
 * Compute the mutation scope of a set of changes, each `{ path, previous? }`
 * with a rename carrying its old path: the full `mutate` list when a change can
 * alter every mutant, otherwise the sorted mutable paths.
 */
export function mutationScope({ changes, tracked, mutate, foundationChanged }) {
    const paths = changes.flatMap(change =>
        change.previous === undefined ? [change.path] : [change.path, change.previous],
    );

    if (foundationChanged || paths.some(path => FULL_SCOPE_TRIGGERS.includes(path))) {
        return [...mutate];
    }

    const mutable = tracked.filter(path => isMutable(path, mutate));
    const present = new Set(mutable);
    const scope = new Set();

    /**
     * Add every mutable source under `directory`.
     */
    const addTree = directory => {
        for (const path of mutable) {
            if (path.startsWith(`${directory}/`)) {
                scope.add(path);
            }
        }
    };

    for (const path of paths) {
        if (path.includes(TEST_SUPPORT)) {
            addTree(path.slice(0, path.indexOf(TEST_SUPPORT)));
        } else if (TEST_FILE.test(path)) {
            const source = path.replace(TEST_FILE, '.ts');

            if (present.has(source)) {
                scope.add(source);
            } else {
                addTree(dirname(path));
            }
        } else if (present.has(path)) {
            scope.add(path);
        }
    }

    return [...scope].sort();
}

/**
 * Parse `git diff --name-status` output into changed paths.
 */
export function parseNameStatus(output) {
    return output
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
            const [status, first, second] = line.split('\t');

            return status.startsWith('R') || status.startsWith('C')
                ? { path: second, previous: first }
                : { path: first };
        });
}

/**
 * Run git with `args` in the working directory and return its stdout.
 */
function git(args) {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Read the `mutate` patterns from the mutation config.
 */
function readMutatePatterns() {
    const { mutate } = JSON.parse(readFileSync('stryker.config.json', 'utf8'));

    if (!Array.isArray(mutate) || mutate.length === 0 || mutate.some(pattern => typeof pattern !== 'string')) {
        throw new MutationScopeError('stryker.config.json has no list of `mutate` patterns.');
    }

    return mutate;
}

/**
 * Whether the installed Foundation differs between `mergeBase` and HEAD.
 */
function foundationChangedSince(mergeBase) {
    /**
     * Parse the lockfile at `ref`, or null when it has none.
     */
    const lockfileAt = ref => {
        try {
            return JSON.parse(git(['show', `${ref}:package-lock.json`]));
        } catch {
            return null;
        }
    };

    return foundationFingerprint(lockfileAt(mergeBase)) !== foundationFingerprint(lockfileAt('HEAD'));
}

/**
 * Print the scope of the changes between `--base` (default origin/master) and
 * HEAD.
 */
function main() {
    const baseIndex = process.argv.indexOf('--base');
    const base = baseIndex === -1 ? 'origin/master' : process.argv[baseIndex + 1];

    let mergeBase;

    try {
        mergeBase = git(['merge-base', base, 'HEAD']).trim();
    } catch {
        throw new MutationScopeError(`Cannot resolve the base '${base}' against HEAD.`);
    }

    const changes = parseNameStatus(git(['diff', '--name-status', '-M', mergeBase, 'HEAD']));
    const scope = mutationScope({
        changes,
        tracked: git(['ls-files'])
            .split('\n')
            .filter(path => path !== ''),
        mutate: readMutatePatterns(),
        foundationChanged:
            changes.some(change => change.path === 'package-lock.json') && foundationChangedSince(mergeBase),
    });

    for (const entry of scope) {
        console.log(entry);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error(`mutation-scope: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}
