/**
 * Print the mutable files changed since `--base <ref>`, one per line.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { execFileSync } from 'node:child_process';

/** Paths that are never mutated. */
const EXCLUDED = [
    path => path.endsWith('.test.ts'),
    path => path.includes('/test-support/'),
    path => path.endsWith('/index.ts'),
    path => path === 'playground/src/main.ts',
    path => path.includes('/locales/'),
];

/** Whether a repo-relative POSIX path matches the `mutate` globs in stryker.config.json. */
function isMutable(path) {
    const included = (path.startsWith('src/') || path.startsWith('playground/src/')) && path.endsWith('.ts');

    return included && !EXCLUDED.some(excluded => excluded(path));
}

/** The mutable files changed between `base` and HEAD (deletions excluded). */
function changedMutableFiles(base) {
    const diff = execFileSync('git', ['diff', '--name-only', '--diff-filter=d', `${base}...HEAD`], {
        encoding: 'utf8',
    });

    return diff.split('\n').filter(path => path !== '' && isMutable(path));
}

const baseIndex = process.argv.indexOf('--base');
const base = baseIndex === -1 ? 'origin/master' : process.argv[baseIndex + 1];

for (const file of changedMutableFiles(base)) {
    console.log(file);
}
