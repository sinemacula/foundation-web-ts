/**
 * Announces each committed session write to the other tabs.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type {
    SessionClearResult,
    SessionPersistence,
    SessionSaveResult,
} from '@sinemacula/foundation/session/session-persistence';

/**
 * Wrap the persistence so every write it commits posts an empty message on the
 * channel once it has resolved, telling the other tabs to read the persisted
 * session again. A failed announcement never fails the write.
 */
export function announceWrites(persistence: SessionPersistence, channel: BroadcastChannel): SessionPersistence {
    /**
     * Announce the write unless it was refused, passing its result through.
     */
    const announce = <R extends SessionSaveResult | SessionClearResult>(result: R): R => {
        if (result.status !== 'changed') {
            try {
                channel.postMessage(null);
            } catch {
                // The channel closes with the module; the write itself stands.
            }
        }

        return result;
    };

    return {
        load: () => persistence.load(),
        saveIf: async (expected, session) => announce(await persistence.saveIf(expected, session)),
        clearIf: async expected => announce(await persistence.clearIf(expected)),
    };
}
