/**
 * Application entry point: boots the application and mounts it.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import '@/assets/styles/app.css';

import { createPlaygroundApp, renderBootFailure } from '@/boot';

const MOUNT_SELECTOR = '#app';

/**
 * Assemble the application and mount it.
 */
async function start(): Promise<void> {
    const app = await createPlaygroundApp({ dev: import.meta.env.DEV, buildTimeEnv: import.meta.env });

    await app.start(MOUNT_SELECTOR);
}

start().catch((error: unknown) => {
    console.error('Application failed to start.', error);

    const mount = document.querySelector(MOUNT_SELECTOR);

    if (mount !== null) {
        renderBootFailure(mount, error, import.meta.env.DEV);
    }
});
