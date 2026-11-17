/**
 * Runtime keys a production deployment must provide.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

/**
 * Keys that must be present and non-empty in a production runtime document.
 */
export const REQUIRED_RUNTIME_KEYS = ['API_URL', 'APP_URL', 'APP_ENV', 'APP_VERSION'] as const;
