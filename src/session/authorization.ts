/**
 * Permission checks against the signed-in session user.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { PermissionSet } from '@sinemacula/foundation/authorization/permission-set';
import { useSessionStore } from './session-store';
import type { SessionUser } from '@sinemacula/foundation/session/session-user';

/**
 * Determine whether the signed-in user holds a permission; false when signed
 * out.
 */
export function can(permission: string): boolean {
    return isAllowed(useSessionStore().user, permission);
}

/**
 * Build a permission check for template bindings. It reads the reactive store
 * user on every call, so `v-if="canCheck('users.view')"` re-evaluates whenever
 * the signed-in user changes.
 */
export function useCan(): (permission: string) => boolean {
    const store = useSessionStore();

    return (permission: string): boolean => isAllowed(store.user, permission);
}

/**
 * Check a permission against a user; false when signed out.
 */
function isAllowed(user: SessionUser | null, permission: string): boolean {
    return user !== null && new PermissionSet(user.permissions).allows(permission);
}
