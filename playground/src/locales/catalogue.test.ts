/**
 * Catalogue tests: every locale defines the same keys, and every key a view
 * translates exists.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { LocaleMessages } from '@sinemacula/foundation-web/module/module';
import { describe, expect, it } from 'vitest';

import { sharedLocaleLoaders } from '@/locales';
import { modules } from '@/modules';

const VIEW_SOURCES = import.meta.glob<string>('../**/*.vue', { query: '?raw', import: 'default', eager: true });

const TRANSLATED_KEY = /\bt\('([^']+)'/g;

/**
 * Load one locale's full catalogue, with each module's messages under its name.
 */
async function loadCatalogue(locale: string): Promise<LocaleMessages> {
    const shared = sharedLocaleLoaders[locale];

    if (shared === undefined) {
        throw new Error(`No shared messages for ${locale}.`);
    }

    const catalogue: LocaleMessages = { ...(await shared()) };

    for (const module of modules) {
        catalogue[module.name] = (await module.locales?.(locale)) ?? {};
    }

    return catalogue;
}

/**
 * Flatten a message tree into its dotted leaf paths.
 */
function leafPaths(messages: unknown, prefix = ''): string[] {
    if (typeof messages !== 'object' || messages === null) {
        return [prefix.slice(0, -1)];
    }

    return Object.entries(messages).flatMap(([key, value]) => leafPaths(value, `${prefix}${key}.`));
}

describe('locale catalogue', () => {
    it('defines the same keys in every locale', async () => {
        const [reference, ...others] = await Promise.all(
            Object.keys(sharedLocaleLoaders).map(async locale => leafPaths(await loadCatalogue(locale)).sort()),
        );

        expect(others.length).toBeGreaterThan(0);

        for (const paths of others) {
            expect(paths).toEqual(reference);
        }
    });

    it('defines every key a view translates', async () => {
        const defined = new Set(leafPaths(await loadCatalogue('en-US')));
        const used = Object.values(VIEW_SOURCES).flatMap(source =>
            [...source.matchAll(TRANSLATED_KEY)].map(match => match[1]),
        );

        expect(used.length).toBeGreaterThan(0);
        expect(used.filter(key => key !== undefined && !defined.has(key))).toEqual([]);
    });
});
