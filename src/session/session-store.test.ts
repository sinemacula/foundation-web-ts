/**
 * Unit tests for useSessionStore's pinia binding over the session core.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick, watch } from 'vue';

import { HttpError } from '@sinemacula/foundation/http/http-error';
import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import { SessionError } from '@sinemacula/foundation/session/session-error';
import type { SessionUser } from '@sinemacula/foundation/session/session-user';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { installSessionContext, resetSessionContext } from './session-context';
import { useSessionStore } from './session-store';
import type { FakeSessionApi } from './test-support/session-fixtures';
import {
    createFakeSessionApi,
    createTestSessionContext,
    deferred,
    persistSnapshot,
    SESSION_KEY,
    snapshot,
    tokens,
    user,
} from './test-support/session-fixtures';

describe('useSessionStore', () => {
    let storage: MemoryStorage;
    let gateway: FakeSessionApi;

    /**
     * Install a context over the test storage and gateway.
     */
    function install(storeId = 'auth'): void {
        installSessionContext(
            createTestSessionContext({ persistence: new KeyValueSessionPersistence(storage), api: gateway, storeId }),
        );
    }

    /**
     * Read the persisted snapshot, or null when none is stored.
     */
    function persisted(): unknown {
        return JSON.parse(storage.get(SESSION_KEY) ?? 'null');
    }

    beforeEach(() => {
        storage = new MemoryStorage();
        gateway = createFakeSessionApi();
        setActivePinia(createPinia());
        install();
    });

    afterEach(() => {
        resetSessionContext();
    });

    it('throws when the session context is not installed', () => {
        resetSessionContext();

        expect(() => useSessionStore()).toThrowError('session context accessed before initialisation');
    });

    it('starts signed out even when a session is persisted', () => {
        persistSnapshot(storage, tokens());

        const store = useSessionStore();

        expect(store.accessToken).toBeNull();
        expect(store.refreshToken).toBeNull();
        expect(store.expiresAtEpochMs).toBeNull();
        expect(store.user).toBeNull();
        expect(store.isAuthenticated).toBe(false);
    });

    it('adopts the persisted session on hydrate', async () => {
        persistSnapshot(storage, tokens({ expiresAtEpochMs: 5_000 }));

        const store = useSessionStore();

        await store.hydrate();

        expect(store.accessToken).toBe('access');
        expect(store.refreshToken).toBe('refresh');
        expect(store.expiresAtEpochMs).toBe(5_000);
        expect(store.isAuthenticated).toBe(true);
    });

    it('rejects hydrate when the persisted session cannot be read', async () => {
        storage.set(SESSION_KEY, 'not json');

        await expect(useSessionStore().hydrate()).rejects.toBeInstanceOf(SessionError);
    });

    it('signs in, persists the session and loads the user, returning the outcome', async () => {
        gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
        gateway.currentUser.mockResolvedValueOnce(user());

        const store = useSessionStore();
        const credentials = { email: 'alice@example.com', password: 'secret' };

        await expect(store.login(credentials)).resolves.toStrictEqual({ kind: 'authenticated' });
        expect(gateway.login).toHaveBeenCalledWith(credentials, { uuid: 'device-uuid', os: 'WEB' }, null);
        expect(store.accessToken).toBe('access');
        expect(store.user).toStrictEqual(user());
        expect(persisted()).toStrictEqual(snapshot(tokens(), 1, 'lineage-2'));
    });

    it('returns a pending authentication unchanged without persisting', async () => {
        const pending = { credential: 'pending', requires: ['mfa'] };

        gateway.login.mockResolvedValueOnce({ kind: 'interactionRequired', pending });

        const store = useSessionStore();

        await expect(store.login({ email: 'a', password: 'b' })).resolves.toStrictEqual({
            kind: 'interactionRequired',
            pending,
        });
        expect(store.isAuthenticated).toBe(false);
        expect(persisted()).toBeNull();
    });

    it('refreshes the held session, returning the outcome', async () => {
        persistSnapshot(storage, tokens());
        gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens({ accessToken: 'rotated' }) });

        const store = useSessionStore();

        await store.hydrate();

        await expect(store.refresh()).resolves.toStrictEqual({ kind: 'refreshed' });
        expect(gateway.refresh).toHaveBeenCalledWith('refresh');
        expect(store.accessToken).toBe('rotated');
    });

    it('returns a refused refresh with the session cleared', async () => {
        const error = new HttpError(401, 'refused');

        persistSnapshot(storage, tokens());
        gateway.refresh.mockResolvedValueOnce({ kind: 'rejected', error });

        const store = useSessionStore();

        await store.hydrate();

        await expect(store.refresh()).resolves.toStrictEqual({ kind: 'rejected', error });
        expect(store.isAuthenticated).toBe(false);
        expect(persisted()).toStrictEqual(snapshot(null, 2));
    });

    it('discards the session locally and from persistence, then signs it out server-side', async () => {
        persistSnapshot(storage, tokens());

        const store = useSessionStore();

        await store.hydrate();
        await store.logout();

        expect(gateway.logout).toHaveBeenCalledWith(tokens());
        expect(store.isAuthenticated).toBe(false);
        expect(persisted()).toStrictEqual(snapshot(null, 2));
    });

    it('clears the session locally at once, then from persistence, without calling the server', async () => {
        persistSnapshot(storage, tokens());

        const store = useSessionStore();

        await store.hydrate();

        const clearing = store.clearLocal();

        expect(store.isAuthenticated).toBe(false);

        await clearing;

        expect(gateway.logout).not.toHaveBeenCalled();
        expect(persisted()).toStrictEqual(snapshot(null, 2));
    });

    it('loads the user of the held session', async () => {
        persistSnapshot(storage, tokens());
        gateway.currentUser.mockResolvedValueOnce(user({ id: 'u2' }));

        const store = useSessionStore();

        await store.hydrate();
        await store.rehydrateUser();

        expect(store.user?.id).toBe('u2');
    });

    it('runs every action over one state, so a clear supersedes a pending sign-in', async () => {
        const pendingUser = deferred<SessionUser>();

        gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
        gateway.currentUser.mockReturnValueOnce(pendingUser.promise);

        const store = useSessionStore();
        const login = store.login({ email: 'a', password: 'b' });

        await expect.poll(() => gateway.currentUser.mock.calls.length).toBe(1);
        await store.clearLocal();
        pendingUser.resolve(user());

        await expect(login).resolves.toStrictEqual({ kind: 'superseded' });
        expect(store.user).toBeNull();
    });

    describe('sessionIdentity', () => {
        it('is null while signed out', () => {
            expect(useSessionStore().sessionIdentity()).toBeNull();
        });

        it('keeps the identity across a rotation, without notifying', async () => {
            persistSnapshot(storage, tokens());
            gateway.refresh.mockResolvedValueOnce({ kind: 'refreshed', tokens: tokens({ accessToken: 'rotated' }) });

            const store = useSessionStore();

            await store.hydrate();

            const identity = store.sessionIdentity();
            const seen: unknown[] = [];

            watch(
                () => store.sessionIdentity(),
                changed => seen.push(changed),
            );
            await store.refresh();
            await nextTick();

            expect(identity).not.toBeNull();
            expect(store.sessionIdentity()).toBe(identity);
            expect(seen).toStrictEqual([]);
        });

        it('notifies a new identity for a sign-in over the same tokens', async () => {
            persistSnapshot(storage, tokens());
            gateway.login.mockResolvedValueOnce({ kind: 'authenticated', tokens: tokens() });
            gateway.currentUser.mockResolvedValueOnce(user());

            const store = useSessionStore();

            await store.hydrate();

            const identity = store.sessionIdentity();
            const seen: unknown[] = [];

            watch(
                () => store.sessionIdentity(),
                changed => seen.push(changed),
            );
            await store.login({ email: 'a', password: 'b' });
            await nextTick();

            expect(store.sessionIdentity()).not.toBe(identity);
            expect(seen).toStrictEqual([store.sessionIdentity()]);
        });

        it('notifies null on sign-out', async () => {
            persistSnapshot(storage, tokens());

            const store = useSessionStore();

            await store.hydrate();

            const seen: unknown[] = [];

            watch(
                () => store.sessionIdentity(),
                changed => seen.push(changed),
            );
            await store.clearLocal();
            await nextTick();

            expect(seen).toStrictEqual([null]);
        });
    });

    it('registers under the store id from the context', () => {
        resetSessionContext();
        install('session-custom');

        expect((useSessionStore() as unknown as Record<'$id', string>).$id).toBe('session-custom');
    });

    it('resolves against an explicitly supplied pinia instance', () => {
        const active = useSessionStore();
        const pinia = createPinia();

        expect(useSessionStore(pinia)).toBe(useSessionStore(pinia));
        expect(useSessionStore(pinia)).not.toBe(active);
    });

    it('exposes a $dispose hook for application disposal', () => {
        expect(typeof useSessionStore().$dispose).toBe('function');
    });
});
