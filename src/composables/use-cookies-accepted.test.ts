/**
 * Unit tests for use-cookies-accepted.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it, vi } from 'vitest';
import { createApp, effectScope, isReadonly } from 'vue';

import { CookieSupport } from '../cookies/cookie-support';
import { createCookieWindow } from '../cookies/test-support/cookie-window';
import { COOKIE_SUPPORT, CookieSupportUnavailableError, useCookiesAccepted } from './use-cookies-accepted';

/**
 * Run a function inside an application that provides the cookie support.
 */
function withSupport<R>(support: CookieSupport, run: () => R): R {
    const app = createApp({});

    app.provide(COOKIE_SUPPORT, support);

    return app.runWithContext(run);
}

/**
 * Build cookie support whose check passed.
 */
function acceptedSupport(): CookieSupport {
    return new CookieSupport({ targetWindow: createCookieWindow().targetWindow });
}

describe('useCookiesAccepted', () => {
    it('follows the cookie support through a read-only ref', () => {
        const support = acceptedSupport();
        const accepted = withSupport(support, useCookiesAccepted);

        expect(accepted.value).toBe(true);
        expect(isReadonly(accepted)).toBe(true);

        support.block();

        expect(accepted.value).toBe(false);
    });

    it('reads cookies blocked by the check', () => {
        const support = new CookieSupport({ targetWindow: createCookieWindow({ enabled: false }).targetWindow });

        expect(withSupport(support, useCookiesAccepted).value).toBe(false);
    });

    it('unsubscribes with the calling scope', () => {
        const support = acceptedSupport();
        const scope = effectScope();
        const accepted = withSupport(support, () => scope.run(useCookiesAccepted));

        scope.stop();
        support.block();

        expect(accepted?.value).toBe(true);
    });

    it('stays subscribed outside a scope, without registering a disposer', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const support = acceptedSupport();
        const accepted = withSupport(support, useCookiesAccepted);

        support.block();

        expect(accepted.value).toBe(false);
        expect(warn).not.toHaveBeenCalled();
    });

    it('throws outside the application', () => {
        expect(() => createApp({}).runWithContext(useCookiesAccepted)).toThrow(CookieSupportUnavailableError);
        expect(() => createApp({}).runWithContext(useCookiesAccepted)).toThrow(
            expect.objectContaining({ name: 'CookieSupportUnavailableError' }),
        );
        expect(() => createApp({}).runWithContext(useCookiesAccepted)).toThrow(
            'useCookiesAccepted() needs the cookie support the application provides.',
        );
    });
});
