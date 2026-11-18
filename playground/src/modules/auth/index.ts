/**
 * Auth module public surface; other modules import from here, never deep paths.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

export { authenticated, authorize } from '@sinemacula/foundation-web/session/middleware';
export { useSessionStore as useAuthStore } from '@sinemacula/foundation-web/session/session-store';
export { AUTH_ROUTE_NAMES } from './route-names';
