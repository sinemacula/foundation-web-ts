/**
 * Unit tests for web-locks-session-lock.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it } from 'vitest';

import { describeSessionLockContract } from '@sinemacula/foundation/session/test-support/session-lock-contract';
import { WebLocksSessionLock } from './web-locks-session-lock';

/** A lock request as the lock manager received it. */
interface LockRequest {
    /** The requested lock name. */
    readonly name: string;

    /** The receiver the request was made on. */
    readonly receiver: unknown;
}

/** A lock manager recording each request. */
interface RecordingLockManager extends LockManager {
    /** Every request, in order. */
    readonly requests: LockRequest[];
}

/** A hold the first task keeps on the lock until the test releases it. */
interface Gate {
    /** Release the hold, letting the first task finish. */
    release?: () => void;
}

/**
 * Build a lock manager granting requests one at a time, recording the names and
 * receivers of each request.
 */
function makeLockManager(): RecordingLockManager {
    let tail: Promise<unknown> = Promise.resolve();
    const requests: LockRequest[] = [];

    const manager = {
        requests,
        query: () => Promise.resolve({}),
        request(this: unknown, name: string, callback: LockGrantedCallback<unknown>): Promise<unknown> {
            requests.push({ name, receiver: this });

            const result = tail.then(() => callback({ mode: 'exclusive', name }));

            tail = result.catch(() => undefined);

            return result;
        },
    };

    return manager as RecordingLockManager;
}

describeSessionLockContract({
    create: () => {
        const manager = makeLockManager();

        return () => new WebLocksSessionLock(manager, 'auth.session:lock');
    },
});

describe('WebLocksSessionLock', () => {
    it('runs the task under the named lock and resolves with its result', async () => {
        const manager = makeLockManager();
        const lock = new WebLocksSessionLock(manager, 'auth.session:lock');

        await expect(lock.run(() => Promise.resolve('done'))).resolves.toBe('done');
        expect(manager.requests).toStrictEqual([{ name: 'auth.session:lock', receiver: manager }]);
    });

    it('runs tasks one at a time in request order', async () => {
        const manager = makeLockManager();
        const lock = new WebLocksSessionLock(manager, 'name');
        const order: string[] = [];
        const gate: Gate = {};

        const first = lock.run(async () => {
            order.push('first:start');
            await new Promise<void>(resolve => {
                gate.release = resolve;
            });
            order.push('first:end');
        });
        const second = lock.run(() => {
            order.push('second');

            return Promise.resolve();
        });

        await Promise.resolve();
        await Promise.resolve();
        gate.release?.();
        await Promise.all([first, second]);

        expect(order).toStrictEqual(['first:start', 'first:end', 'second']);
    });

    it('rejects with the error of a failing task', async () => {
        const failure = new Error('task failed');
        const lock = new WebLocksSessionLock(makeLockManager(), 'name');

        await expect(lock.run(() => Promise.reject(failure))).rejects.toBe(failure);
    });

    it('rejects with the error of a failing lock request', async () => {
        const failure = new DOMException('aborted', 'AbortError');
        const manager = { query: () => Promise.resolve({}), request: () => Promise.reject(failure) } as LockManager;
        const lock = new WebLocksSessionLock(manager, 'name');

        await expect(lock.run(() => Promise.resolve('never'))).rejects.toBe(failure);
    });
});
