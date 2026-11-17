/**
 * Prints the allow-listed environment as a deployment's `runtime-env.json`.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

// The output is public, so only allow-listed keys are exposed. APP_VERSION must
// change per release: the update monitor diffs it to detect new deployments.
const DEFAULT_KEYS = [
    'APP_ENV',
    'APP_VERSION',
    'API_URL',
    'APP_URL',
    'STATIC_URL',
    'STREAM_URL',
    'DEFAULT_LOCALE',
    'ENABLED_LOCALES',
    'FEATURE_FLAGS',
    'SEGMENT_WRITE_KEY',
    'SENTRY_DSN',
];

const keys =
    (process.env.RUNTIME_ENV_KEYS ?? '').trim() === ''
        ? DEFAULT_KEYS
        : (process.env.RUNTIME_ENV_KEYS ?? '').split(/\s+/u);

const values = {};

for (const key of keys) {
    const value = process.env[key];

    if (value !== undefined && value !== '') {
        values[key] = value;
    }
}

process.stdout.write(`${JSON.stringify(values, null, 4)}\n`);
