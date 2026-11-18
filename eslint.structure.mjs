/**
 * The repo's own eslint preset, run against itself by `lint:structure`.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import foundationWeb from './eslint/index.js';

// Run with --no-inline-config: shared-standards directives name unloaded rules.
export default foundationWeb;
