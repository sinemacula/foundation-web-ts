/**
 * The application's composition over the kernel preset, and its boot fallback.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type {
    FoundationWebApp,
    FoundationWebPlatformOptions,
} from '@sinemacula/foundation-web/app/create-foundation-web-app';
import {
    FoundationWebBootError,
    createFoundationWebApp,
} from '@sinemacula/foundation-web/app/create-foundation-web-app';
import { createWebEnvironment } from '@sinemacula/foundation-web/config/web-environment';
import { createSessionModule } from '@sinemacula/foundation-web/session/create-session-module';

import App from '@/App.vue';
import type { Configuration } from '@/config';
import { defineConfiguration } from '@/config';
import { REQUIRED_RUNTIME_KEYS } from '@/config/runtime';
import { sharedLocaleLoaders } from '@/locales';
import { localeFormats } from '@/locales/formats';
import { modules } from '@/modules';

/**
 * The build-specific inputs the application boots with.
 */
export interface PlaygroundBootOptions {
    /** Whether this is a development build, which relaxes required runtime keys. */
    readonly dev: boolean;

    /** Build-time env consulted behind the runtime document in development. */
    readonly buildTimeEnv: Readonly<Record<string, unknown>>;

    /** Platform seams to replace, such as fetch, storage and history. */
    readonly platform?: FoundationWebPlatformOptions;
}

/**
 * Assemble the application through the kernel preset, ready to start.
 */
export function createPlaygroundApp(options: PlaygroundBootOptions): Promise<FoundationWebApp<Configuration>> {
    return createFoundationWebApp({
        root: App,
        modules: [createSessionModule(), ...modules],
        config: {
            createEnvironment: runtime =>
                createWebEnvironment({
                    runtime,
                    dev: options.dev,
                    buildTimeEnv: options.buildTimeEnv,
                    requiredKeys: REQUIRED_RUNTIME_KEYS,
                }),
            define: defineConfiguration,
        },
        http: { unexpectedErrorToastKey: 'common.states.error' },
        i18n: { sharedLoaders: sharedLocaleLoaders, formats: localeFormats },
        monitors: { updates: { toastKey: 'common.updates.available' } },
        platform: options.platform ?? {},
    });
}

/**
 * Replace the mount node's content with the boot failure notice; the error's
 * message is shown as text, and only in development.
 */
export function renderBootFailure(mount: Element, error: unknown, dev: boolean): void {
    const doc = mount.ownerDocument;
    const panel = doc.createElement('div');
    const heading = doc.createElement('strong');

    panel.style.padding = '2rem';
    panel.style.fontFamily = 'sans-serif';
    heading.textContent = 'The application could not start.';
    panel.append(heading);

    if (error instanceof FoundationWebBootError && error.reference !== null) {
        const reference = doc.createElement('p');

        reference.textContent = `Reference: ${error.reference}`;
        panel.append(reference);
    }

    if (dev && error instanceof Error) {
        const detail = doc.createElement('p');

        detail.textContent = error.message;
        panel.append(detail);
    }

    mount.replaceChildren(panel);
}
