/**
 * Install the packed tarball into a clean consumer outside the repo, then
 * typecheck it, lint it with the shipped preset, build it and boot it in a
 * browser. Set `KEEP_CONSUMER=1` to keep the consumer directory for debugging.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = 4174;
const CONSUMER_URL = `http://localhost:${PORT}/`;

/**
 * A step of the consumer smoke test that failed.
 */
class ConsumerSmokeError extends Error {}

const manifest = readJson(join(ROOT, 'package.json'));
const locked = readJson(join(ROOT, 'package-lock.json')).packages;
const subpaths = Object.keys(manifest.exports).filter(subpath => subpath !== './eslint');
const workspace = mkdtempSync(join(tmpdir(), 'web-core-consumer-'));
const consumer = join(workspace, 'consumer');

/**
 * Read and parse a JSON file.
 */
function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Write `content` to `path` under the consumer, creating parent directories.
 */
function write(path, content) {
    const target = join(consumer, path);

    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, content);
}

/**
 * Run a command to completion, echoing its output and throwing on failure.
 */
function run(command, args, cwd = consumer) {
    console.log(`\n$ ${command} ${args.join(' ')}`);

    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

/**
 * Run a binary installed in the consumer.
 */
function bin(name, args) {
    return run(join(consumer, 'node_modules/.bin', name), args);
}

/**
 * Pin each named dependency to the version the repo's lockfile resolves.
 */
function pin(names) {
    return Object.fromEntries(names.map(name => [name, locked[`node_modules/${name}`].version]));
}

/**
 * Typecheck the consumer against the shipped declarations; errors inside
 * third-party declarations are not ours to fix, so only the consumer's own
 * sources and the Sine Macula packages count.
 */
function typecheck() {
    let output = '';

    try {
        typecheck();
    } catch (error) {
        output = String(error.stdout);
    }

    const ours = output.split('\n').filter(line => /^(src\/|node_modules\/@sinemacula\/)/u.test(line));

    if (ours.length > 0) {
        throw new ConsumerSmokeError(`The consumer does not typecheck:\n${ours.join('\n')}`);
    }
}

/**
 * The camelCase namespace alias for an exported subpath.
 */
function alias(subpath) {
    return subpath.slice(2).replace(/[/-](\w)/gu, (_, letter) => letter.toUpperCase());
}

/**
 * Write the consumer's manifest, pinned to the repo's resolved versions.
 */
function writeManifest(tarball) {
    write(
        'package.json',
        JSON.stringify(
            {
                name: 'web-core-consumer',
                private: true,
                type: 'module',
                dependencies: {
                    '@sinemacula/web-core': `file:${tarball}`,
                    ...pin(['pinia', 'vue', 'vue-i18n', 'vue-router']),
                },
                devDependencies: pin([
                    '@typescript-eslint/utils',
                    'eslint',
                    'typescript',
                    'typescript-eslint',
                    'vite',
                    'vue-eslint-parser',
                ]),
            },
            null,
            4,
        ),
    );
}

/**
 * Write the consumer's TypeScript, ESLint and page configuration.
 */
function writeConfigs() {
    write(
        'tsconfig.json',
        JSON.stringify(
            {
                compilerOptions: {
                    target: 'ES2023',
                    lib: ['ES2023', 'DOM', 'DOM.Iterable'],
                    module: 'ESNext',
                    moduleResolution: 'bundler',
                    strict: true,
                    noEmit: true,
                    skipLibCheck: false,
                    types: ['vite/client'],
                },
                include: ['src'],
            },
            null,
            4,
        ),
    );

    write('eslint.config.js', "import webCore from '@sinemacula/web-core/eslint';\n\nexport default webCore;\n");
    write('public/runtime-env.json', '{}\n');
    write(
        'index.html',
        '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Consumer</title></head>' +
            '<body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n',
    );
}

/**
 * Write the consumer's entry, importing every exported subpath and booting a
 * one-route app through the kernel.
 */
function writeEntry() {
    const imports = subpaths.map(
        subpath => `import * as ${alias(subpath)} from '@sinemacula/web-core/${subpath.slice(2)}';`,
    );

    write(
        'src/main.ts',
        `${imports.join('\n')}
import { computed, defineComponent, h, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterView } from 'vue-router';

const surfaces = [${subpaths.map(alias).join(', ')}];

const Home = defineComponent({
    setup() {
        const { t } = useI18n();
        const clicks = ref(0);
        const label = computed(() => t('consumer.clicked', { count: clicks.value }));

        return () => [
            h('h1', t('consumer.ready')),
            h('button', { type: 'button', onClick: () => (clicks.value += 1) }, label.value),
        ];
    },
});

const app = await appCreateWebCoreApp.createWebCoreApp({
    root: defineComponent({ render: () => h(RouterView) }),
    modules: [
        {
            name: 'consumer',
            routes: [{ path: '/', component: Home }],
            locales: moduleModule.createLocaleLoader({
                'en-US': async () => ({ ready: 'Consumer ready', clicked: 'Clicked {count}' }),
            }),
        },
    ],
    config: {
        createEnvironment: runtime => configWebEnvironment.createWebEnvironment({ runtime, dev: false }),
        define: () => ({
            api: { baseUrl: 'http://localhost:1', timeout: 1000 },
            app: { name: 'Consumer', environment: 'smoke', version: '1.0.0' },
            featureFlags: { flags: {} },
            locales: { default: 'en-US', enabled: ['en-US'], supported: { 'en-US': { direction: 'ltr' } } },
        }),
    },
});

await app.start('#app');

document.documentElement.dataset['emptySurfaces'] = String(surfaces.filter(surface => Object.keys(surface).length === 0).length);
`,
    );
}

/**
 * Wait until `url` answers, or fail after `timeoutMs`.
 */
async function waitForServer(url, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            if ((await fetch(url)).ok) {
                return;
            }
        } catch {
            // Not listening yet.
        }

        await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
    }

    throw new ConsumerSmokeError(`The consumer preview did not start at ${url}.`);
}

/**
 * Serve the built consumer and drive it in Chromium, failing on any page or
 * console error.
 */
async function boot() {
    const server = spawn(
        join(consumer, 'node_modules/.bin/vite'),
        ['preview', '--port', String(PORT), '--strictPort'],
        {
            cwd: consumer,
            stdio: 'inherit',
        },
    );
    const browser = await chromium.launch();

    try {
        await waitForServer(CONSUMER_URL);

        const page = await browser.newPage();
        const failures = [];

        page.on('pageerror', error => failures.push(`page error: ${error.message}`));
        page.on('console', message => {
            if (message.type() === 'error') {
                failures.push(`console error: ${message.text()}`);
            }
        });

        try {
            await page.goto(CONSUMER_URL);
            await page.getByRole('heading', { name: 'Consumer ready' }).waitFor({ timeout: 10_000 });
            await page.getByRole('button', { name: 'Clicked 0' }).click();
            await page.getByRole('button', { name: 'Clicked 1' }).waitFor({ timeout: 10_000 });
        } catch (error) {
            throw new ConsumerSmokeError([error.message, ...failures].join('\n'));
        }

        const emptySurfaces = await page.locator('html').getAttribute('data-empty-surfaces');

        if (emptySurfaces !== '0') {
            failures.push(`${emptySurfaces} exported subpaths resolved to an empty module`);
        }

        if (failures.length > 0) {
            throw new ConsumerSmokeError(`The consumer failed in the browser:\n${failures.join('\n')}`);
        }
    } finally {
        await browser.close();
        server.kill();
    }
}

try {
    const tarball = join(
        workspace,
        run('npm', ['pack', '--pack-destination', workspace, '--silent'], ROOT).trim().split('\n').pop(),
    );

    writeManifest(tarball);
    writeConfigs();
    writeEntry();
    run('npm', ['install', '--no-audit', '--no-fund']);

    typecheck();

    const config = JSON.parse(bin('eslint', ['--print-config', 'src/main.ts']));

    for (const rule of ['@sinemacula/web-core/no-snake-case-keys', '@sinemacula/web-core/module-import-boundary']) {
        if (config.rules?.[rule] === undefined) {
            throw new ConsumerSmokeError(`The ESLint preset did not enable ${rule}.`);
        }
    }

    bin('eslint', ['src']);
    bin('vite', ['build']);

    await boot();

    console.log('\nThe packed tarball installs, typechecks, lints, builds and boots in a clean consumer.');
} finally {
    if (process.env['KEEP_CONSUMER'] === '1') {
        console.log(`Consumer kept at ${consumer}`);
    } else {
        rmSync(workspace, { recursive: true, force: true });
    }
}
