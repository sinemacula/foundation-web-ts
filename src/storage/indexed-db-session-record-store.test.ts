/**
 * Unit tests for indexed-db-session-record-store.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { forceCloseDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import { RecordSessionPersistence } from '@sinemacula/foundation/session/record-session-persistence';
import { SessionError } from '@sinemacula/foundation/session/session-error';
import type { SessionRecordStore } from '@sinemacula/foundation/session/session-record-store';
import { describeSessionPersistenceContract } from '@sinemacula/foundation/session/test-support/session-persistence-contract';
import { describeSessionRecordStoreContract } from '@sinemacula/foundation/session/test-support/session-record-store-contract';
import { IndexedDbSessionRecordStore } from './indexed-db-session-record-store';

const DATABASE = 'auth.session';

/**
 * Build a factory whose every open throws, as where site storage is blocked.
 */
function blockedFactory(): IDBFactory {
    return {
        open: () => {
            throw new DOMException('The operation is insecure.', 'SecurityError');
        },
    } as unknown as IDBFactory;
}

/**
 * Settle a raw IndexedDB request.
 */
function settled<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            resolve(request.result);
        };
        request.onerror = () => {
            reject(request.error ?? new Error('request failed'));
        };
    });
}

/**
 * Store a raw value under the record key, as another writer of the database
 * could.
 */
async function storeRaw(factory: IDBFactory, value: unknown): Promise<void> {
    await new IndexedDbSessionRecordStore(factory, DATABASE).read();

    const database = await settled(factory.open(DATABASE));
    const transaction = database.transaction('session', 'readwrite');

    transaction.objectStore('session').put(value, 'snapshot');
    await new Promise(resolve => {
        transaction.oncomplete = resolve;
    });
    database.close();
}

/**
 * Wrap a store so every operation first waits for the given setup.
 */
function after(setup: Promise<unknown>, store: SessionRecordStore): SessionRecordStore {
    return {
        read: async () => {
            await setup;

            return store.read();
        },
        swap: async decide => {
            await setup;

            return store.swap(decide);
        },
    };
}

/**
 * Capture every connection the factory opens.
 */
function captureConnections(factory: IDBFactory): IDBDatabase[] {
    const connections: IDBDatabase[] = [];
    const open = factory.open.bind(factory);

    vi.spyOn(factory, 'open').mockImplementation((name, version) => {
        const request = open(name, version);

        request.addEventListener('success', () => {
            connections.push(request.result);
        });

        return request;
    });

    return connections;
}

describeSessionRecordStoreContract({
    create: () => {
        const factory = new IDBFactory();

        return () => new IndexedDbSessionRecordStore(factory, DATABASE);
    },
    failing: record => {
        const factory = new IDBFactory();
        const put = IDBObjectStore.prototype.put;
        const setup = new IndexedDbSessionRecordStore(factory, DATABASE)
            .swap(() => record)
            .then(() => {
                vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
                    this: IDBObjectStore,
                    ...args: Parameters<IDBObjectStore['put']>
                ) {
                    const request = put.apply(this, args);

                    this.transaction.abort();

                    return request;
                });
            });

        return () => after(setup, new IndexedDbSessionRecordStore(factory, DATABASE));
    },
    broken: () => new IndexedDbSessionRecordStore(blockedFactory(), DATABASE),
});

describe('the session persistence over IndexedDbSessionRecordStore', () => {
    describeSessionPersistenceContract({
        create: () => {
            const factory = new IDBFactory();

            return () => new RecordSessionPersistence(new IndexedDbSessionRecordStore(factory, DATABASE));
        },
        broken: () => new RecordSessionPersistence(new IndexedDbSessionRecordStore(blockedFactory(), DATABASE)),
    });
});

describe('IndexedDbSessionRecordStore', () => {
    it('keeps each database apart', async () => {
        const factory = new IDBFactory();

        await new IndexedDbSessionRecordStore(factory, 'one').swap(() => 'first');

        await expect(new IndexedDbSessionRecordStore(factory, 'two').read()).resolves.toBeNull();
        await expect(new IndexedDbSessionRecordStore(factory, 'one').read()).resolves.toBe('first');
    });

    it('writes under strict durability', async () => {
        const factory = new IDBFactory();
        const store = new IndexedDbSessionRecordStore(factory, DATABASE);
        const connections = captureConnections(factory);

        await store.read();

        const transaction = vi.spyOn(connections[0] as IDBDatabase, 'transaction');

        await store.swap(() => 'record');

        expect(transaction).toHaveBeenCalledWith('session', 'readwrite', { durability: 'strict' });
    });

    it('rejects a stored value that is not a string, without deciding or replacing it', async () => {
        const factory = new IDBFactory();
        const store = new IndexedDbSessionRecordStore(factory, DATABASE);
        const decide = vi.fn(() => 'replaced');

        await storeRaw(factory, 42);

        await expect(store.read()).rejects.toThrow(new SessionError('The stored session record is not a string.'));
        await expect(store.swap(decide)).rejects.toBeInstanceOf(SessionError);
        expect(decide).not.toHaveBeenCalled();
    });

    it('rejects with the failure of a decision, leaving the record as it was', async () => {
        const store = new IndexedDbSessionRecordStore(new IDBFactory(), DATABASE);
        const failure = new Error('decision failed');

        await store.swap(() => 'kept');

        await expect(
            store.swap(() => {
                throw failure;
            }),
        ).rejects.toBe(failure);
        await expect(store.read()).resolves.toBe('kept');
    });

    it('rejects when the database fails to open, and opens it again on the next operation', async () => {
        const factory = new IDBFactory();
        const newer = await settled(factory.open(DATABASE, 2));
        const store = new IndexedDbSessionRecordStore(factory, DATABASE);

        newer.close();

        await expect(store.read()).rejects.toHaveProperty('name', 'VersionError');

        await settled(factory.deleteDatabase(DATABASE));

        await expect(store.read()).resolves.toBeNull();
    });

    it('rejects a transaction aborted without an error, leaving the record as it was', async () => {
        const store = new IndexedDbSessionRecordStore(new IDBFactory(), DATABASE);

        await store.swap(() => 'kept');
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore) {
            this.transaction.abort();

            return {} as IDBRequest<IDBValidKey>;
        });

        await expect(store.swap(() => 'replaced')).rejects.toThrow(
            new SessionError('The session record transaction was aborted.'),
        );
        await expect(store.read()).resolves.toBe('kept');
    });

    it('rejects a record the store cannot hold with the failure of the write', async () => {
        const store = new IndexedDbSessionRecordStore(new IDBFactory(), DATABASE);

        await expect(store.swap(() => (() => 'not cloneable') as unknown as string)).rejects.toHaveProperty(
            'name',
            'DataCloneError',
        );
        await expect(store.read()).resolves.toBeNull();
    });

    it('rejects an open that fails without an error', async () => {
        const request = { error: null } as unknown as IDBOpenDBRequest;
        const factory = {
            open: () => {
                queueMicrotask(() => request.onerror?.call(request, new Event('error')));

                return request;
            },
        } as unknown as IDBFactory;

        await expect(new IndexedDbSessionRecordStore(factory, DATABASE).read()).rejects.toThrow(
            new SessionError('The session record database could not be opened.'),
        );
    });

    it('closes its connection for a deletion elsewhere, then opens a fresh database', async () => {
        const factory = new IDBFactory();
        const store = new IndexedDbSessionRecordStore(factory, DATABASE);

        await store.swap(() => 'record');
        await settled(factory.deleteDatabase(DATABASE));

        await expect(store.read()).resolves.toBeNull();
    });

    it('opens again once the browser closes its connection', async () => {
        const factory = new IDBFactory();
        const store = new IndexedDbSessionRecordStore(factory, DATABASE);
        const connections = captureConnections(factory);

        await store.swap(() => 'record');
        forceCloseDatabase(connections[0] as never);

        await expect(store.read()).resolves.toBe('record');
        expect(connections).toHaveLength(2);
    });

    it('reuses one connection across operations', async () => {
        const factory = new IDBFactory();
        const store = new IndexedDbSessionRecordStore(factory, DATABASE);
        const connections = captureConnections(factory);

        await store.swap(() => 'record');
        await store.read();

        expect(connections).toHaveLength(1);
    });
});
