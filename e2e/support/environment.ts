/**
 * Where the suite runs: the dev server locally, a production preview in CI or
 * under `E2E_PREVIEW=1`.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

/** Whether the run is in CI. */
export const IS_CI = process.env['CI'] !== undefined;

/** Whether the app is served from the production preview build. */
export const SERVED_BY_PREVIEW = IS_CI || process.env['E2E_PREVIEW'] === '1';

/** The port the app is served on. */
export const PORT = SERVED_BY_PREVIEW ? 4173 : 5173;

/** The origin the app is served from. */
export const BASE_URL = `http://localhost:${PORT}`;

/** The origin of the API the app talks to; every request to it is mocked. */
export const API_ORIGIN = 'http://localhost:8000';
