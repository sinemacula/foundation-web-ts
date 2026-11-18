/**
 * Retires the session snapshot earlier releases kept in localStorage.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { SessionPersistence, SessionVersion } from '@sinemacula/foundation/session/session-persistence';

const UNWRITTEN: SessionVersion = { revision: 0, lineage: null };

/**
 * Move a session the legacy persistence holds into the current one, only while
 * the current one has never been written, then clear it from the legacy one so
 * tabs still running an earlier release sign out instead of exchanging its
 * tokens. Once the current persistence holds a revision it is the only
 * authority: later legacy sessions are cleared without being adopted. An
 * unreadable legacy snapshot, which holds no usable session, is cleared too.
 */
export async function retireLegacySession(legacy: SessionPersistence, current: SessionPersistence): Promise<void> {
    const snapshot = await legacy.load().catch(() => null);

    if (snapshot === null) {
        await legacy.clearIf(UNWRITTEN);

        return;
    }

    if (snapshot.session === null) {
        return;
    }

    await current.saveIf(UNWRITTEN, snapshot.session);
    await legacy.clearIf({ revision: snapshot.revision, lineage: snapshot.session.lineage });
}
