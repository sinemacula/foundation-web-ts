/**
 * Retires the session snapshot earlier releases kept in localStorage.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { SessionLock } from '@sinemacula/foundation/session/session-lock';
import type { SessionPersistence, SessionVersion } from '@sinemacula/foundation/session/session-persistence';

const UNWRITTEN: SessionVersion = { revision: 0, lineage: null };

/**
 * Under the exchange lock earlier releases share, move a legacy session into
 * the current persistence only while it has never been written, then clear the
 * legacy snapshot, unreadable ones included.
 */
export async function retireLegacySession(
    legacy: SessionPersistence,
    current: SessionPersistence,
    lock: SessionLock,
): Promise<void> {
    const holdsSession = await legacy.load().then(
        snapshot => snapshot.session !== null,
        () => true,
    );

    if (!holdsSession) {
        return;
    }

    await lock.run(async () => {
        const snapshot = await legacy.load().catch(() => null);

        if (snapshot === null) {
            await legacy.clearIf(UNWRITTEN);
        } else if (snapshot.session !== null) {
            await current.saveIf(UNWRITTEN, snapshot.session);
            await legacy.clearIf({ revision: snapshot.revision, lineage: snapshot.session.lineage });
        }
    });
}
