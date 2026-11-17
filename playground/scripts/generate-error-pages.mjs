/**
 * Writes localised static HTTP error pages into `dist/errors/` after a build.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const localesDir = join(appRoot, 'src', 'locales');
const themeStylesheet = join(appRoot, 'src', 'assets', 'styles', 'theme.css');
const outputDir = join(appRoot, 'dist', 'errors');

const defaultLocale = 'en-US';

/** Each status code maps to the `httpErrors` key holding its copy. */
const errorKeys = {
    400: 'badRequest',
    403: 'forbidden',
    404: 'notFound',
    405: 'methodNotAllowed',
    414: 'uriTooLong',
    416: 'rangeNotSatisfiable',
    500: 'internalServerError',
    501: 'notImplemented',
    502: 'badGateway',
    503: 'serviceUnavailable',
    504: 'gatewayTimeout',
};

/** Verbatim copy of the kernel's first-paint colour-scheme boot script. */
const bootScript = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}`;

/** The layout layer, built on the inlined design tokens. */
const layoutStyles = `
        *,
        *::before,
        *::after {
            box-sizing: border-box;
        }

        * {
            margin: 0;
        }

        body {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: var(--sm-space-6);
            background: var(--sm-surface-page);
            color: var(--sm-text-body);
            font-family: var(--sm-font-sans);
            font-size: var(--sm-text-base);
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
        }

        .error {
            max-width: 32rem;
            text-align: center;
        }

        .error__code {
            font-size: 4rem;
            font-weight: 700;
            line-height: 1;
            color: var(--sm-accent);
        }

        .error__title {
            margin-top: var(--sm-space-4);
            font-size: var(--sm-text-xl);
            font-weight: 700;
            color: var(--sm-text-strong);
        }

        .error__message {
            margin-top: var(--sm-space-3);
            color: var(--sm-text-muted);
        }

        .error__home {
            display: inline-block;
            margin-top: var(--sm-space-6);
            color: var(--sm-accent);
            font-weight: 500;
            text-decoration: none;
        }

        .error__home:hover {
            text-decoration: underline;
        }

        :focus-visible {
            outline: var(--sm-focus-ring);
            outline-offset: var(--sm-focus-offset);
        }`;

/**
 * Import a shared locale module's default export; Node strips its types.
 */
async function loadMessages(file) {
    const loaded = await import(pathToFileURL(file).href);

    return loaded.default;
}

/**
 * Escape the characters that would break out of body text.
 */
function escapeHtml(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Turn a locale filename into its canonical tag (`fr-fr.ts` -> `fr-FR`).
 */
function fileToTag(file) {
    const [language, region] = file.replace(/\.ts$/, '').split('-');

    return `${language}-${region.toUpperCase()}`;
}

/** Swaps in the stored or browser locale's copy from the `#e-data` island. */
const swapScript = `(function(){var raw;try{raw=JSON.parse(document.getElementById('e-data').textContent)}catch(e){return}var v=raw.v,d=raw.d;function b(l){return String(l).slice(0,2).toLowerCase()}function m(){var c=[];try{c.push(localStorage.getItem('locale'))}catch(e){}var n=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];for(var j=0;j<n.length;j++)c.push(n[j]);for(var i=0;i<c.length;i++){var l=c[i];if(!l)continue;if(v[l])return l;var base=b(l);for(var k in v){if(b(k)===base)return k}}return d}var key=m(),p=v[key];var t=document.getElementById('e-title');if(t)t.textContent=p.t;var msg=document.getElementById('e-message');if(msg)msg.textContent=p.m;var h=document.getElementById('e-home');if(h)h.textContent=p.h;document.documentElement.lang=key;document.title=raw.code+' '+p.t})()`;

/**
 * Render one error page with everything inline, since during an outage the
 * hashed assets may be what is failing.
 */
function renderErrorPage(code, variants, tokens) {
    const fallback = variants[defaultLocale];
    const data = escapeHtml(JSON.stringify({ v: variants, d: defaultLocale, code: String(code) }));

    return `<!doctype html>
<html lang="${defaultLocale.slice(0, 2)}">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#f8fafc" />
        <title>${code} ${escapeHtml(fallback.t)}</title>
        <script>${bootScript}</script>
        <style>
${tokens}
${layoutStyles}
        </style>
    </head>
    <body>
        <main class="error">
            <p class="error__code">${code}</p>
            <h1 class="error__title" id="e-title">${escapeHtml(fallback.t)}</h1>
            <p class="error__message" id="e-message">${escapeHtml(fallback.m)}</p>
            <a class="error__home" id="e-home" href="/">${escapeHtml(fallback.h)}</a>
        </main>
        <div id="e-data" hidden>${data}</div>
        <script>${swapScript}</script>
    </body>
</html>
`;
}

const tokens = readFileSync(themeStylesheet, 'utf8').trimEnd();

const localeTags = readdirSync(localesDir)
    .filter(file => /^[a-z]{2,3}-[a-z]{2,4}\.ts$/.test(file))
    .map(fileToTag);

const httpErrorsByTag = {};

for (const tag of localeTags) {
    const messages = await loadMessages(join(localesDir, `${tag.toLowerCase()}.ts`));

    httpErrorsByTag[tag] = messages.httpErrors;
}

mkdirSync(outputDir, { recursive: true });

for (const code of Object.keys(errorKeys)) {
    const key = errorKeys[code];
    const variants = {};

    for (const tag of localeTags) {
        const copy = httpErrorsByTag[tag];

        variants[tag] = { t: copy[key].title, m: copy[key].message, h: copy.home };
    }

    writeFileSync(join(outputDir, `${code}.html`), renderErrorPage(code, variants, tokens));
}
