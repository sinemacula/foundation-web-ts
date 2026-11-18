/**
 * {@link SessionRecordStore} over IndexedDB, swapping the record atomically
 * across every tab of the origin.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { SessionError } from '@sinemacula/foundation/session/session-error';
import type { SessionRecordStore } from '@sinemacula/foundation/session/session-record-store';

const STORE = 'session';

const RECORD_KEY = 'snapshot';

/**
 * Keep the record under one key of a dedicated IndexedDB database, each
 * operation in a transaction of its own.
 */
export class IndexedDbSessionRecordStore implements SessionRecordStore {
    /** The factory the database is opened through. */
    readonly #factory: IDBFactory;

    /** The name of the database holding the record. */
    readonly #database: string;

    /** The open, or opening, connection; null until first used and once lost. */
    #connection: Promise<IDBDatabase> | null = null;

    constructor(factory: IDBFactory, database: string) {
        this.#factory = factory;
        this.#database = database;
    }

    /**
     * Read the record.
     *
     * @throws {@link SessionError} when the stored record is not a string
     */
    read(): Promise<string | null> {
        return this.#transact('readonly', (_store, stored) => recordOf(stored));
    }

    /**
     * Read the record, decide and write it in one readwrite transaction,
     * resolving once the transaction has committed.
     */
    swap(decide: (current: string | null) => string | null): Promise<void> {
        return this.#transact('readwrite', (store, stored) => {
            const next = decide(recordOf(stored));

            if (next !== null) {
                store.put(next, RECORD_KEY);
            }
        });
    }

    /**
     * Hand the stored value to `operate` synchronously in a fresh transaction,
     * settling once it completes or aborts; a throw aborts it with that error.
     */
    async #transact<T>(mode: IDBTransactionMode, operate: (store: IDBObjectStore, stored: unknown) => T): Promise<T> {
        const database = await this.#connect();

        return new Promise<T>((resolve, reject) => {
            const transaction = database.transaction(STORE, mode, { durability: 'strict' });
            const store = transaction.objectStore(STORE);
            const request = store.get(RECORD_KEY);
            let result: T;
            let failed = false;
            let failure: unknown;

            request.onsuccess = () => {
                try {
                    result = operate(store, request.result);
                } catch (error) {
                    failed = true;
                    failure = error;
                    transaction.abort();
                }
            };
            transaction.oncomplete = () => {
                resolve(result);
            };
            transaction.onabort = () => {
                reject(
                    failed
                        ? failure
                        : (transaction.error ?? new SessionError('The session record transaction was aborted.')),
                );
            };
        });
    }

    /**
     * Resolve the connection, opening it on first use and again once it is
     * lost, closed for another context's upgrade or deletion, or failed to
     * open.
     */
    #connect(): Promise<IDBDatabase> {
        if (this.#connection !== null) {
            return this.#connection;
        }

        const connection = this.#open();

        /**
         * Forget the connection, so the next operation opens another.
         */
        const forget = (): void => {
            this.#connection = null;
        };

        this.#connection = connection;
        connection.then(database => {
            database.onclose = forget;
            database.onversionchange = () => {
                forget();
                database.close();
            };
        }, forget);

        return connection;
    }

    /**
     * Open the database, creating its object store on first open.
     */
    #open(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = this.#factory.open(this.#database, 1);

            request.onupgradeneeded = () => {
                request.result.createObjectStore(STORE);
            };
            request.onsuccess = () => {
                resolve(request.result);
            };
            request.onerror = () => {
                reject(request.error ?? new SessionError('The session record database could not be opened.'));
            };
        });
    }
}

/**
 * Narrow a stored value to the record, absent reading as null.
 *
 * @throws {@link SessionError} when the value is not a string
 */
function recordOf(stored: unknown): string | null {
    if (stored === undefined) {
        return null;
    }

    if (typeof stored !== 'string') {
        throw new SessionError('The stored session record is not a string.');
    }

    return stored;
}
