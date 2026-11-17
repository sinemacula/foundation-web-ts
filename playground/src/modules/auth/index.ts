/**
 * Auth module public surface.
 *
 * This is the only entry point other modules may import from when they need
 * anything from the auth module; deep paths inside `src/modules/auth/**` are
 * module-internal. The guards and store come from the kernel session module and
 * are re-exported under the module's established names.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export { authenticated, authorize } from '@sinemacula/web-core/session/middleware';
export { useSessionStore as useAuthStore } from '@sinemacula/web-core/session/session-store';
export { AUTH_ROUTE_NAMES } from './route-names';
