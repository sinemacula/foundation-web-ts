/**
 * Tests for the static error page generator and the scripts its pages run.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = join(import.meta.dirname, 'generate-error-pages.mjs');

const STATUS_CODES = ['400', '403', '404', '405', '414', '416', '500', '501', '502', '503', '504'];

/** What the page's scripts can see of the visitor's browser. */
interface Visitor {
    /** Values the visitor has in local storage. */
    readonly stored?: Readonly<Record<string, string>>;

    /** The browser's preferred languages, most preferred first. */
    readonly languages?: readonly string[];
}

let outputDir = '';

/**
 * Parse a generated page and run its inline scripts for the given visitor.
 */
function open(code: string, visitor: Visitor = {}): Document {
    const page = new DOMParser().parseFromString(readFileSync(join(outputDir, `${code}.html`), 'utf8'), 'text/html');
    const storage = { getItem: (key: string): string | null => visitor.stored?.[key] ?? null };
    const languages = visitor.languages ?? [];
    const browser = { languages, language: languages[0] ?? '' };

    for (const script of Array.from(page.querySelectorAll('script'))) {
        new Function('document', 'localStorage', 'navigator', script.textContent)(page, storage, browser);
    }

    return page;
}

/**
 * Read the localised title the visitor ends up seeing.
 */
function titleOf(page: Document): string | null | undefined {
    return page.getElementById('e-title')?.textContent;
}

/** The 503 page's title and home link copy per locale. */
const UNAVAILABLE_COPY = {
    'en-US': { title: 'Service Unavailable', home: 'Return to the homepage' },
    'fr-FR': { title: 'Service indisponible', home: "Retour à la page d'accueil" },
} as const;

describe('generate-error-pages', () => {
    beforeAll(() => {
        outputDir = mkdtempSync(join(tmpdir(), 'error-pages-'));
        execFileSync(process.execPath, [SCRIPT, outputDir]);
    });

    afterAll(() => {
        rmSync(outputDir, { recursive: true, force: true });
    });

    it('writes one page per supported status code', () => {
        expect(readdirSync(outputDir).sort()).toEqual(STATUS_CODES.map(code => `${code}.html`));
    });

    it('renders the default locale copy before any script runs', () => {
        const html = readFileSync(join(outputDir, '404.html'), 'utf8');
        const page = new DOMParser().parseFromString(html, 'text/html');

        expect(page.documentElement.lang).toBe('en');
        expect(page.title).toBe('404 Not Found');
        expect(titleOf(page)).toBe('Not Found');
        expect(page.querySelector('.error__code')?.textContent).toBe('404');
        expect(page.getElementById('e-home')?.getAttribute('href')).toBe('/');
    });

    it('inlines its styles rather than linking hashed assets', () => {
        const html = readFileSync(join(outputDir, '500.html'), 'utf8');

        expect(html).toContain('--sm-accent');
        expect(html).not.toMatch(/<link\b|<script\s+src=/);
    });

    it.each([
        ['an exact browser locale', { languages: ['fr-FR'] }, 'fr-FR'],
        ['a regional browser locale by its base language', { languages: ['fr-CA'] }, 'fr-FR'],
        ['a stored locale ahead of the browser', { stored: { locale: 'en-US' }, languages: ['fr-FR'] }, 'en-US'],
        [
            'the browser past an unsupported stored locale',
            { stored: { locale: 'de-DE' }, languages: ['fr-FR'] },
            'fr-FR',
        ],
        ['the default for an unsupported browser locale', { languages: ['de-DE'] }, 'en-US'],
    ] as const)('localises the page for %s', (_case, visitor, expected) => {
        const page = open('503', visitor);
        const copy = UNAVAILABLE_COPY[expected];

        expect(titleOf(page)).toBe(copy.title);
        expect(page.getElementById('e-home')?.textContent).toBe(copy.home);
        expect(page.documentElement.lang).toBe(expected);
        expect(page.title).toBe(`503 ${copy.title}`);
    });

    it.each([
        ['light', 'light'],
        ['dark', 'dark'],
        ['unknown', null],
    ])('applies a stored %s theme before first paint', (stored, expected) => {
        const page = open('404', { stored: { theme: stored } });

        expect(page.documentElement.getAttribute('data-theme')).toBe(expected);
    });
});
