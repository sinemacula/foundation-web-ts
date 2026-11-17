/**
 * Unit tests for can and useCan.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SessionUser } from '@sinemacula/foundation/session/session-user';
import { can, useCan } from './authorization';
import { installSessionContext, resetSessionContext } from './session-context';
import { useSessionStore } from './session-store';
import { createTestSessionContext, user } from './test-support/session-fixtures';

/** The writable session user slot on the store state. */
interface WritableSessionUser {
    /** The authenticated user, or null when signed out. */
    user: SessionUser | null;
}

/** Write the session user directly onto the store state. */
function setStoreUser(signedIn: SessionUser | null): void {
    (useSessionStore() as unknown as WritableSessionUser).user = signedIn;
}

describe('can', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        installSessionContext(createTestSessionContext());
    });

    afterEach(() => {
        resetSessionContext();
    });

    it('returns false when no user is signed in', () => {
        expect(can('users.view')).toBe(false);
    });

    it('returns true when the signed-in user holds the permission', () => {
        setStoreUser(user({ permissions: ['users.view'] }));

        expect(can('users.view')).toBe(true);
    });

    it('returns false when the signed-in user lacks the permission', () => {
        setStoreUser(user({ permissions: ['billing.view'] }));

        expect(can('users.view')).toBe(false);
    });

    it('returns true when the permission matches a wildcard grant', () => {
        setStoreUser(user({ permissions: ['users.*'] }));

        expect(can('users.edit.self')).toBe(true);
    });
});

describe('useCan', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        installSessionContext(createTestSessionContext());
    });

    afterEach(() => {
        resetSessionContext();
    });

    it('returns a function reflecting the current permission state', () => {
        const checkPermission = useCan();

        expect(checkPermission('users.view')).toBe(false);
    });

    it('re-evaluates when the store user changes', () => {
        const checkPermission = useCan();

        expect(checkPermission('users.view')).toBe(false);

        setStoreUser(user({ permissions: ['users.view'] }));

        expect(checkPermission('users.view')).toBe(true);
    });

    it('reflects a permission being lost when the store user changes again', () => {
        setStoreUser(user({ permissions: ['users.view'] }));

        const checkPermission = useCan();

        expect(checkPermission('users.view')).toBe(true);

        setStoreUser(user({ permissions: [] }));

        expect(checkPermission('users.view')).toBe(false);
    });
});
