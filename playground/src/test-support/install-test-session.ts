/**
 * Test seam installing the kernel session context.
 *
 * Component and composable tests that exercise the session store install the
 * context here instead of booting the full application. The session persists as
 * the revisioned snapshot under the default session key of the given storage,
 * hydrated on first readiness like the session module does, and the API gateway
 * is resolved lazily over the kernel HTTP client holder, so a test may swap the
 * installed fake client after this runs and the session still reaches the
 * current one.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { api } from '@sinemacula/web-core/app/services';
import { TokenRefreshCoordinator } from '@sinemacula/foundation/http/token-refresh-coordinator';
import { createDefaultSessionApi } from '@sinemacula/foundation/session/default-session-api';
import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import type { SessionApi } from '@sinemacula/foundation/session/session-api';
import { scheduleOnTimers } from '@sinemacula/web-core/module/module';
import { installSessionContext } from '@sinemacula/web-core/session/session-context';
import { useSessionStore } from '@sinemacula/web-core/session/session-store';
import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';

export { resetSessionContext } from '@sinemacula/web-core/session/session-context';

/**
 * Install a session context matching the application's defaults.
 *
 * @param storage - the storage the session snapshot persists to
 */
export function installTestSession(storage: KeyValueStorage): void {
    let hydration: Promise<void> | null = null;

    installSessionContext({
        persistence: new KeyValueSessionPersistence(storage),
        routes: { login: { name: 'auth.login' }, loginPath: '/login', home: '/', forbidden: '/forbidden' },
        storeId: 'auth',
        coordinator: new TokenRefreshCoordinator({ refresh: () => useSessionStore().refresh() }),
        ready: () => {
            hydration ??= useSessionStore().hydrate();

            return hydration;
        },
        clock: () => Date.now(),
        schedule: scheduleOnTimers,
        refreshSkewMs: 60_000,
        device: () => ({ uuid: 'test-device-uuid', os: 'WEB' }),
        get api(): SessionApi {
            return createDefaultSessionApi(api());
        },
    });
}
