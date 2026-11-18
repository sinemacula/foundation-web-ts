/**
 * Unit tests for legacy-session-migration.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it } from 'vitest';

import { InProcessSessionLock } from '@sinemacula/foundation/session/in-process-session-lock';
import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import type { SessionLock } from '@sinemacula/foundation/session/session-lock';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { retireLegacySession } from './legacy-session-migration';
import { LINEAGE, persistSnapshot, SESSION_KEY, snapshot, tokens } from './test-support/session-fixtures';

/**
 * Build a persistence over its own in-memory storage, holding the given
 * snapshot when one is given.
 */
function persistenceHolding(
    storage: MemoryStorage,
    held?: Parameters<typeof persistSnapshot>[1],
    revision?: number,
): KeyValueSessionPersistence {
    if (held !== undefined) {
        persistSnapshot(storage, held, revision);
    }

    return new KeyValueSessionPersistence(storage);
}

describe('retireLegacySession', () => {
    it('moves a legacy session into a never-written persistence and clears the legacy one', async () => {
        const legacyStorage = new MemoryStorage();
        const legacy = persistenceHolding(legacyStorage, tokens(), 4);
        const current = persistenceHolding(new MemoryStorage());

        await retireLegacySession(legacy, current, new InProcessSessionLock());

        await expect(current.load()).resolves.toStrictEqual(snapshot(tokens()));
        await expect(legacy.load()).resolves.toStrictEqual(snapshot(null, 5));
    });

    it('clears a legacy session without adopting it once the persistence has been written', async () => {
        const legacy = persistenceHolding(new MemoryStorage(), tokens({ accessToken: 'legacy' }), 4);
        const current = persistenceHolding(new MemoryStorage(), null, 2);

        await retireLegacySession(legacy, current, new InProcessSessionLock());

        await expect(current.load()).resolves.toStrictEqual(snapshot(null, 2));
        await expect(legacy.load()).resolves.toStrictEqual(snapshot(null, 5));
    });

    it('takes no lock over an empty legacy snapshot', async () => {
        const lock: SessionLock = { run: () => Promise.reject(new Error('The lock must not be taken.')) };

        await expect(
            retireLegacySession(
                persistenceHolding(new MemoryStorage(), null, 3),
                persistenceHolding(new MemoryStorage()),
                lock,
            ),
        ).resolves.toBeUndefined();
    });

    it('clears an unreadable legacy snapshot under the lock', async () => {
        const legacyStorage = new MemoryStorage();
        const legacy = persistenceHolding(legacyStorage);
        const current = persistenceHolding(new MemoryStorage());

        legacyStorage.set(SESSION_KEY, 'not json');
        await retireLegacySession(legacy, current, new InProcessSessionLock());

        await expect(legacy.load()).resolves.toStrictEqual(snapshot(null, 1));
        await expect(current.load()).resolves.toStrictEqual(snapshot(null, 0));
    });

    it('decides again under the lock, adopting nothing another context retired meanwhile', async () => {
        const legacyStorage = new MemoryStorage();
        const legacy = persistenceHolding(legacyStorage, tokens());
        const current = persistenceHolding(new MemoryStorage());
        const lock: SessionLock = {
            run: task => {
                persistSnapshot(legacyStorage, null, 2, LINEAGE);

                return task();
            },
        };

        await retireLegacySession(legacy, current, lock);

        await expect(current.load()).resolves.toStrictEqual(snapshot(null, 0));
        await expect(legacy.load()).resolves.toStrictEqual(snapshot(null, 2));
    });
});
