/**
 * Unit tests for the session guard factories.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HttpError } from '@sinemacula/foundation/http/http-error';
import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import type { SessionUser } from '@sinemacula/foundation/session/session-user';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import type { MiddlewareContext, RouteMiddleware } from '../router/middleware';
import type { SessionRoutes } from './create-session-module';
import { authenticated, authorize, guestOnly } from './middleware';
import { installSessionContext, resetSessionContext, sessionContext } from './session-context';
import { useSessionStore } from './session-store';
import type { FakeSessionApi } from './test-support/session-fixtures';
import {
    createFakeSessionApi,
    createTestSessionContext,
    deferred,
    persistSnapshot,
    tokens,
} from './test-support/session-fixtures';

const context = { to: { fullPath: '/settings/billing' }, from: {} } as unknown as MiddlewareContext;

/** An authenticated user record granted the given permissions. */
function userWithPermissions(permissions: readonly string[]): SessionUser {
    return { id: 'u1', email: 'alice@example.com', name: 'Alice Smith', permissions };
}

describe('session guards', () => {
    let storage: MemoryStorage;
    let gateway: FakeSessionApi;

    /**
     * Install a test session context over the test storage and gateway.
     *
     * @param routes - route-identity overrides
     */
    function installTestContext(routes: Partial<SessionRoutes> = {}): void {
        const base = createTestSessionContext();

        installSessionContext({
            ...base,
            persistence: new KeyValueSessionPersistence(storage),
            api: gateway,
            routes: { ...base.routes, ...routes },
        });
    }

    /**
     * Persist a session and load the given user once it is hydrated.
     *
     * @param permissions - the permissions the user is granted
     */
    function signIn(permissions: readonly string[] = []): void {
        persistSnapshot(storage, tokens());
        gateway.currentUser.mockResolvedValue(userWithPermissions(permissions));
    }

    /**
     * Run a guard over the shared navigation context.
     *
     * @param guard - the guard to run
     * @returns the guard's result
     */
    function run(guard: RouteMiddleware): unknown {
        return guard.handle(context);
    }

    beforeEach(() => {
        storage = new MemoryStorage();
        gateway = createFakeSessionApi();
        setActivePinia(createPinia());
        installTestContext();
    });

    afterEach(() => {
        resetSessionContext();
    });

    describe('readiness', () => {
        it.each([
            ['authenticated', authenticated()],
            ['guestOnly', guestOnly()],
            ['authorize', authorize('users.view')],
        ])('%s decides only once the session has hydrated', async (_name, guard) => {
            const hydrated = deferred<undefined>();

            resetSessionContext();
            installSessionContext(createTestSessionContext({ ready: () => hydrated.promise }));

            let settled = false;
            const decision = Promise.resolve(run(guard)).then(result => {
                settled = true;

                return result;
            });

            await Promise.resolve();

            expect(settled).toBe(false);

            hydrated.resolve(undefined);

            await expect(decision).resolves.toHaveProperty('kind');
        });
    });

    describe('authenticated', () => {
        it('admits a visitor whose persisted session hydrates', async () => {
            signIn();

            await expect(run(authenticated())).resolves.toStrictEqual({ kind: 'next' });
        });

        it('admits regardless of a custom redirect target', async () => {
            signIn();

            await expect(run(authenticated({ name: 'some.route' }))).resolves.toStrictEqual({ kind: 'next' });
        });

        it('redirects a signed-out visitor to the login route, carrying the attempted path', async () => {
            await expect(run(authenticated())).resolves.toStrictEqual({
                kind: 'redirect',
                to: { name: 'auth.login', query: { redirect: '/settings/billing' } },
            });
        });

        it('redirects a signed-out visitor to a custom target, carrying the attempted path', async () => {
            await expect(run(authenticated({ name: 'custom.route' }))).resolves.toStrictEqual({
                kind: 'redirect',
                to: { name: 'custom.route', query: { redirect: '/settings/billing' } },
            });
        });

        it('resolves the login route from the context at handle time', async () => {
            const guard = authenticated();

            resetSessionContext();
            installTestContext({ login: { name: 'custom.login' } });

            await expect(run(guard)).resolves.toStrictEqual({
                kind: 'redirect',
                to: { name: 'custom.login', query: { redirect: '/settings/billing' } },
            });
        });
    });

    describe('guestOnly', () => {
        it('admits a signed-out visitor', async () => {
            await expect(run(guestOnly())).resolves.toStrictEqual({ kind: 'next' });
        });

        it('admits a signed-out visitor regardless of a custom redirect target', async () => {
            await expect(run(guestOnly({ name: 'some.route' }))).resolves.toStrictEqual({ kind: 'next' });
        });

        it('redirects a visitor whose persisted session hydrates to the home route', async () => {
            signIn();

            await expect(run(guestOnly())).resolves.toStrictEqual({ kind: 'redirect', to: '/' });
        });

        it('redirects an authenticated visitor to a custom target', async () => {
            signIn();

            await expect(run(guestOnly({ name: 'custom.route' }))).resolves.toStrictEqual({
                kind: 'redirect',
                to: { name: 'custom.route' },
            });
        });

        it('resolves the home route from the context at handle time', async () => {
            const guard = guestOnly();

            signIn();
            resetSessionContext();
            installTestContext({ home: '/dashboard' });

            await expect(run(guard)).resolves.toStrictEqual({ kind: 'redirect', to: '/dashboard' });
        });
    });

    describe('authorize', () => {
        it('redirects a signed-out visitor to the login route, carrying the attempted path', async () => {
            await expect(run(authorize('users.view'))).resolves.toStrictEqual({
                kind: 'redirect',
                to: { name: 'auth.login', query: { redirect: '/settings/billing' } },
            });
        });

        it('loads the user, then admits when the permission is held', async () => {
            signIn(['users.view']);

            await expect(run(authorize('users.view'))).resolves.toStrictEqual({ kind: 'next' });
            expect(gateway.currentUser).toHaveBeenCalledTimes(1);
        });

        it('admits through a wildcard grant', async () => {
            signIn(['users.*']);

            await expect(run(authorize('users.view'))).resolves.toStrictEqual({ kind: 'next' });
        });

        it('redirects to the forbidden route when the permission is missing', async () => {
            signIn([]);

            await expect(run(authorize('users.view'))).resolves.toStrictEqual({ kind: 'redirect', to: '/forbidden' });
        });

        it('redirects to a custom target when the permission is missing', async () => {
            signIn([]);

            await expect(run(authorize('users.view', { name: 'forbidden.route' }))).resolves.toStrictEqual({
                kind: 'redirect',
                to: { name: 'forbidden.route' },
            });
        });

        it('resolves the forbidden route from the context at handle time', async () => {
            const guard = authorize('users.view');

            signIn([]);
            resetSessionContext();
            installTestContext({ forbidden: '/no-access' });

            await expect(run(guard)).resolves.toStrictEqual({ kind: 'redirect', to: '/no-access' });
        });

        it('redirects to the login route when the session is lost while loading the user', async () => {
            signIn(['users.view']);
            gateway.currentUser.mockReset();
            gateway.currentUser.mockImplementationOnce(async () => {
                await sessionContext().coordinator.refresh();

                throw new HttpError(401, 'expired');
            });
            gateway.refresh.mockResolvedValueOnce({ kind: 'rejected', error: new HttpError(401, 'refused') });

            await expect(run(authorize('users.view'))).resolves.toStrictEqual({
                kind: 'redirect',
                to: { name: 'auth.login', query: { redirect: '/settings/billing' } },
            });
            expect(useSessionStore().isAuthenticated).toBe(false);
        });

        it('reuses an already loaded user', async () => {
            signIn(['users.view']);
            await useSessionStore().hydrate();
            await useSessionStore().rehydrateUser();

            await expect(run(authorize('users.view'))).resolves.toStrictEqual({ kind: 'next' });
            expect(gateway.currentUser).toHaveBeenCalledTimes(1);
        });
    });
});
