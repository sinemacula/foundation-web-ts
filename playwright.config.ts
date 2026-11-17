/**
 * Playwright config: the dev server locally, a production preview build in CI
 * or under `E2E_PREVIEW=1`. Firefox and WebKit run the `@engine` specs.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { defineConfig, devices } from '@playwright/test';

import { BASE_URL, IS_CI, PORT, SERVED_BY_PREVIEW } from './e2e/support/environment';

const ENGINE_SPECS = /@engine/u;

export default defineConfig({
    testDir: './e2e/specs',
    fullyParallel: true,
    forbidOnly: IS_CI,
    retries: IS_CI ? 2 : 0,
    reporter: [['list'], ['html', { open: 'never', outputFolder: 'build/playwright-report' }]],
    use: {
        // biome-ignore lint/style/useNamingConvention: Playwright API property
        baseURL: BASE_URL,
        serviceWorkers: 'block',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'mobile-chromium',
            use: { ...devices['Pixel 7'] },
        },
        {
            name: 'firefox',
            grep: ENGINE_SPECS,
            use: { ...devices['Desktop Firefox'] },
        },
        {
            name: 'webkit',
            grep: ENGINE_SPECS,
            use: { ...devices['Desktop Safari'] },
        },
        {
            name: 'mobile-webkit',
            grep: ENGINE_SPECS,
            use: { ...devices['iPhone 15'] },
        },
    ],
    webServer: {
        command: SERVED_BY_PREVIEW
            ? `npm run build && APP_ENV=e2e APP_VERSION=e2e API_URL=http://localhost:8000 APP_URL=${BASE_URL} DEFAULT_LOCALE=en-US ENABLED_LOCALES='["en-US","fr-FR"]' node playground/scripts/generate-runtime-env.mjs > playground/dist/runtime-env.json && npm run preview --workspace playground -- --port ${PORT} --strictPort`
            : `npm run dev --workspace playground -- --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !IS_CI,
        timeout: 120_000,
    },
});
