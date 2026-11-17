/**
 * Unit tests for the session refresh coordinator.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it, vi } from 'vitest';

import { HttpError, NetworkError } from '@sinemacula/foundation/http/http-error';
import type { RefreshOutcome } from '@sinemacula/foundation/session/session-outcomes';
import { SessionRefreshCoordinator } from './session-refresh-coordinator';
import { deferred } from './test-support/session-fixtures';

describe('SessionRefreshCoordinator', () => {
    it('collapses concurrent refreshes into one', async () => {
        const pending = deferred<RefreshOutcome>();
        const refresh = vi.fn(() => pending.promise);
        const coordinator = new SessionRefreshCoordinator(refresh);

        const first = coordinator.refresh();
        const second = coordinator.refresh();

        pending.resolve({ kind: 'refreshed' });

        await expect(first).resolves.toStrictEqual({ kind: 'refreshed' });
        await expect(second).resolves.toStrictEqual({ kind: 'refreshed' });
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it.each<[string, RefreshOutcome]>([
        ['refused', { kind: 'rejected', error: new HttpError(401, 'refused') }],
        [
            'returned to pending authentication',
            { kind: 'interactionRequired', pending: { credential: 'p', requires: ['mfa'] } },
        ],
        ['failed', { kind: 'failed', error: new HttpError(422, 'malformed') }],
    ])('tells each subscriber once when a shared refresh is %s', async (_label, outcome) => {
        const coordinator = new SessionRefreshCoordinator(() => Promise.resolve(outcome));
        const first = vi.fn();
        const second = vi.fn();

        coordinator.onTerminal(first);
        coordinator.onTerminal(second);

        await Promise.all([coordinator.refresh(), coordinator.refresh()]);

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it.each<[string, RefreshOutcome]>([
        ['refreshed', { kind: 'refreshed' }],
        ['retryable', { kind: 'retryable', error: new NetworkError('offline') }],
        ['superseded', { kind: 'superseded' }],
    ])('tells no subscriber about a %s refresh', async (_label, outcome) => {
        const coordinator = new SessionRefreshCoordinator(() => Promise.resolve(outcome));
        const listener = vi.fn();

        coordinator.onTerminal(listener);

        await expect(coordinator.refresh()).resolves.toBe(outcome);
        expect(listener).not.toHaveBeenCalled();
    });

    it('stops telling a subscriber that unsubscribed', async () => {
        const coordinator = new SessionRefreshCoordinator(() =>
            Promise.resolve({ kind: 'failed', error: new HttpError(422, 'malformed') }),
        );
        const listener = vi.fn();

        coordinator.onTerminal(listener)();
        await coordinator.refresh();

        expect(listener).not.toHaveBeenCalled();
    });
});
