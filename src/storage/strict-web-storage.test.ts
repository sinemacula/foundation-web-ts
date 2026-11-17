/**
 * Unit tests for strict-web-storage.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it } from 'vitest';

import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import { describeSessionPersistenceContract } from '@sinemacula/foundation/session/test-support/session-persistence-contract';
import { describeKeyValueStorageContract } from '@sinemacula/foundation/storage/test-support/key-value-storage-contract';
import { createLockManager } from '../session/test-support/session-fixtures';
import { StrictWebStorage } from './strict-web-storage';
import { WebLocksSessionLock } from './web-locks-session-lock';

/** Build an in-memory Web Storage area. */
function makeStorage(): Storage {
    const entries = new Map<string, string>();

    return {
        length: 0,
        key: () => null,
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => {
            entries.set(key, value);
        },
        removeItem: (key: string) => {
            entries.delete(key);
        },
        clear: () => {
            entries.clear();
        },
    };
}

/** Build a Web Storage area whose every operation throws. */
function makeFailingStorage(error: Error): Storage {
    /** Throw the storage failure. */
    const fail = (): never => {
        throw error;
    };

    return { length: 0, key: fail, getItem: fail, setItem: fail, removeItem: fail, clear: fail };
}

describeKeyValueStorageContract({ create: () => new StrictWebStorage(makeStorage()) });

describe('the session persistence over StrictWebStorage and a Web Locks lock', () => {
    describeSessionPersistenceContract({
        create: () => {
            const area = makeStorage();
            const locks = createLockManager();

            return () =>
                new KeyValueSessionPersistence(new StrictWebStorage(area), {
                    lock: new WebLocksSessionLock(locks, 'auth.session:lock'),
                });
        },
        broken: () => new KeyValueSessionPersistence(new StrictWebStorage(makeFailingStorage(new Error('blocked')))),
    });
});

describe('StrictWebStorage', () => {
    it('reads null for an absent key', () => {
        expect(new StrictWebStorage(makeStorage()).get('missing')).toBeNull();
    });

    it('writes, reads and removes through the storage area', () => {
        const area = makeStorage();
        const storage = new StrictWebStorage(area);

        storage.set('key', 'value');

        expect(area.getItem('key')).toBe('value');
        expect(storage.get('key')).toBe('value');

        storage.remove('key');

        expect(area.getItem('key')).toBeNull();
    });

    it('lets a failing read throw', () => {
        const failure = new Error('read failed');

        expect(() => new StrictWebStorage(makeFailingStorage(failure)).get('key')).toThrow(failure);
    });

    it('lets a failing write throw', () => {
        const failure = new Error('quota exceeded');

        expect(() => {
            new StrictWebStorage(makeFailingStorage(failure)).set('key', 'value');
        }).toThrow(failure);
    });

    it('lets a failing removal throw', () => {
        const failure = new Error('storage disabled');

        expect(() => {
            new StrictWebStorage(makeFailingStorage(failure)).remove('key');
        }).toThrow(failure);
    });
});
