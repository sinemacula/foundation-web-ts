/**
 * Unit tests for the session context holder.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, describe, expect, it } from 'vitest';

import { installSessionContext, resetSessionContext, sessionContext } from './session-context';
import { createTestSessionContext } from './test-support/session-fixtures';

describe('sessionContext', () => {
    afterEach(() => {
        resetSessionContext();
    });

    it('throws before the context is installed', () => {
        expect(() => sessionContext()).toThrowError('session context accessed before initialisation');
    });

    it('returns the installed context', () => {
        const context = createTestSessionContext();

        installSessionContext(context);

        expect(sessionContext()).toBe(context);
    });

    it('replaces a previously installed context', () => {
        const first = createTestSessionContext();
        const second = createTestSessionContext();

        installSessionContext(first);
        installSessionContext(second);

        expect(sessionContext()).toBe(second);
    });

    it('throws again after resetSessionContext', () => {
        installSessionContext(createTestSessionContext());
        resetSessionContext();

        expect(() => sessionContext()).toThrowError('session context accessed before initialisation');
    });
});
