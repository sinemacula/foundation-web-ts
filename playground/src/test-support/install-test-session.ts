/**
 * Test seam installing the kernel session context without booting the app.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { api } from '@sinemacula/foundation-web/app/services';
import { createDefaultSessionApi } from '@sinemacula/foundation/session/default-session-api';
import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import type { SessionApi } from '@sinemacula/foundation/session/session-api';
import { scheduleOnTimers } from '@sinemacula/foundation-web/module/module';
import { installSessionContext } from '@sinemacula/foundation-web/session/session-context';
import { SessionRefreshCoordinator } from '@sinemacula/foundation-web/session/session-refresh-coordinator';
import { useSessionStore } from '@sinemacula/foundation-web/session/session-store';
import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';

export { resetSessionContext } from '@sinemacula/foundation-web/session/session-context';

/**
 * Install a session context matching the application's defaults.
 */
export function installTestSession(storage: KeyValueStorage): void {
    let hydration: Promise<void> | null = null;

    installSessionContext({
        persistence: new KeyValueSessionPersistence(storage),
        routes: { login: { name: 'auth.login' }, loginPath: '/login', home: '/', forbidden: '/forbidden' },
        storeId: 'auth',
        coordinator: new SessionRefreshCoordinator(() => useSessionStore().refresh()),
        ready: () => {
            hydration ??= useSessionStore().hydrate();

            return hydration;
        },
        clock: () => Date.now(),
        schedule: scheduleOnTimers,
        refreshSkewMs: 60_000,
        device: () => ({ uuid: 'test-device-uuid', os: 'WEB' }),
        createLineage: () => crypto.randomUUID(),
        // Resolved per access so a test can swap the installed client later.
        get api(): SessionApi {
            return createDefaultSessionApi(api());
        },
    });
}
