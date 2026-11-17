/**
 * Unit tests for the required runtime keys.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it } from 'vitest';

import { REQUIRED_RUNTIME_KEYS } from '@/config/runtime';

describe('REQUIRED_RUNTIME_KEYS', () => {
    it('lists the keys a production deployment must provide', () => {
        expect(REQUIRED_RUNTIME_KEYS).toEqual(['API_URL', 'APP_URL', 'APP_ENV', 'APP_VERSION']);
    });
});
