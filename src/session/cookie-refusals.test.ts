/**
 * Unit tests for cookie-refusals.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it } from 'vitest';

import { CookieSupport } from '../cookies/cookie-support';
import { createCookieWindow } from '../cookies/test-support/cookie-window';
import { CookieRefusals } from './cookie-refusals';

/**
 * Build cookie support whose check passed.
 */
function acceptedSupport(): CookieSupport {
    return new CookieSupport({ targetWindow: createCookieWindow().targetWindow });
}

describe('CookieRefusals', () => {
    it('blocks cookies on attach for a refusal reported before', () => {
        const refusals = new CookieRefusals();
        const support = acceptedSupport();

        refusals.report();

        expect(support.accepted).toBe(true);

        refusals.attach(support);

        expect(support.accepted).toBe(false);
    });

    it('blocks cookies as soon as a refusal is reported once attached', () => {
        const refusals = new CookieRefusals();
        const support = acceptedSupport();

        refusals.attach(support);

        expect(support.accepted).toBe(true);

        refusals.report();

        expect(support.accepted).toBe(false);
    });

    it('takes refusals without cookie support to tell', () => {
        const refusals = new CookieRefusals();

        refusals.report();

        expect(() => {
            refusals.attach(null);
            refusals.report();
        }).not.toThrow();
    });
});
