/**
 * Application entry point: boots the kernel preset with this app's inputs.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import '@/assets/styles/app.css';

import { createWebCoreApp } from '@sinemacula/web-core/app/create-web-core-app';
import { createWebEnvironment } from '@sinemacula/web-core/config/web-environment';
import { createSessionModule } from '@sinemacula/web-core/session/create-session-module';

import App from '@/App.vue';
import { defineConfiguration } from '@/config';
import { REQUIRED_RUNTIME_KEYS } from '@/config/runtime';
import { sharedLocaleLoaders } from '@/locales';
import { localeFormats } from '@/locales/formats';
import { modules } from '@/modules';

const MOUNT_SELECTOR = '#app';

/**
 * Assemble the application through the kernel preset and mount it.
 */
async function start(): Promise<void> {
    const app = await createWebCoreApp({
        root: App,
        modules: [createSessionModule(), ...modules],
        config: {
            createEnvironment: runtime =>
                createWebEnvironment({
                    runtime,
                    dev: import.meta.env.DEV,
                    buildTimeEnv: import.meta.env,
                    requiredKeys: REQUIRED_RUNTIME_KEYS,
                }),
            define: defineConfiguration,
        },
        http: { unexpectedErrorToastKey: 'common.states.error' },
        i18n: { sharedLoaders: sharedLocaleLoaders, formats: localeFormats },
        monitors: { updates: { toastKey: 'common.updates.available' } },
    });

    await app.start(MOUNT_SELECTOR);
}

start().catch((error: unknown) => {
    console.error('Application failed to start.', error);

    const mount = document.querySelector(MOUNT_SELECTOR);

    if (mount === null) {
        return;
    }

    const detail = import.meta.env.DEV && error instanceof Error ? `<p>${error.message}</p>` : '';

    mount.innerHTML = `<div style="padding:2rem;font-family:sans-serif"><strong>The application could not start.</strong>${detail}</div>`;
});
