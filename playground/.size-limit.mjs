/**
 * Size budgets over the production build; the first-paint set is read from the
 * built `index.html`, so a dependency pulled onto the critical path fails it.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(import.meta.dirname, 'dist');

/**
 * Collect the `dist`-relative asset paths an attribute references in index.html.
 */
function referencedAssets(html, pattern) {
    const assets = [...html.matchAll(pattern)].map(match => join('dist', match[1]));

    if (assets.length === 0) {
        throw new Error(`index.html references no assets matching ${pattern}; rebuild before measuring.`);
    }

    return assets;
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');

export default [
    {
        name: 'first-paint js (gzip)',
        path: referencedAssets(html, /<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="\/([^"]+\.js)"/g),
        gzip: true,
        limit: '90 KB',
    },
    {
        name: 'first-paint css (gzip)',
        path: referencedAssets(html, /<link[^>]*rel="stylesheet"[^>]*\shref="\/([^"]+\.css)"/g),
        gzip: true,
        limit: '3 KB',
    },
    {
        name: 'login route js (gzip)',
        path: 'dist/assets/login-view-*.js',
        gzip: true,
        limit: '40 KB',
    },
    {
        name: 'application js (gzip)',
        path: 'dist/assets/*.js',
        gzip: true,
        limit: '140 KB',
    },
    {
        name: 'application css (gzip)',
        path: 'dist/assets/*.css',
        gzip: true,
        limit: '6 KB',
    },
];
