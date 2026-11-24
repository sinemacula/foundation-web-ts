/**
 * Unit tests for cookie-support.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it, vi } from 'vitest';

import { CookieSupport } from './cookie-support';
import { createCookieWindow } from './test-support/cookie-window';

describe('CookieSupport', () => {
    describe('the check when built', () => {
        it('accepts cookies when the browser keeps a test cookie, deleting it again', () => {
            const { targetWindow, writes, jar } = createCookieWindow();

            expect(new CookieSupport({ targetWindow }).accepted).toBe(true);
            expect(writes).toStrictEqual([
                'cookie-check-zz=1; Max-Age=60; Path=/; SameSite=Strict; Secure',
                'cookie-check-zz=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Strict; Secure',
            ]);
            expect(jar.size).toBe(0);
        });

        it('writes the test cookie without Secure over http', () => {
            const { targetWindow, writes } = createCookieWindow({ protocol: 'http:' });

            expect(new CookieSupport({ targetWindow }).accepted).toBe(true);
            expect(writes).toStrictEqual([
                'cookie-check-zz=1; Max-Age=60; Path=/; SameSite=Strict',
                'cookie-check-zz=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Strict',
            ]);
        });

        it('blocks cookies when the browser has them disabled, writing nothing', () => {
            const { targetWindow, writes } = createCookieWindow({ enabled: false });

            expect(new CookieSupport({ targetWindow }).accepted).toBe(false);
            expect(writes).toStrictEqual([]);
        });

        it('blocks cookies when the browser drops the test cookie', () => {
            const { targetWindow, writes } = createCookieWindow({ keeps: false });

            expect(new CookieSupport({ targetWindow }).accepted).toBe(false);
            expect(writes).toHaveLength(2);
        });

        it('counts only the exact test cookie', () => {
            const { targetWindow } = createCookieWindow({
                keeps: false,
                jar: { 'cookie-check-zz': '10', 'other-cookie-check-zz': '1' },
            });

            expect(new CookieSupport({ targetWindow }).accepted).toBe(false);
        });

        it('blocks cookies when the document refuses access to them', () => {
            const { targetWindow } = createCookieWindow({ throws: true });

            expect(new CookieSupport({ targetWindow }).accepted).toBe(false);
        });

        it('checks the global window by default, leaving no cookie behind', () => {
            const before = document.cookie;

            expect(new CookieSupport().accepted).toBe(true);
            expect(document.cookie).toBe(before);
        });
    });

    describe('block', () => {
        it('marks cookies blocked and notifies subscribers once', () => {
            const support = new CookieSupport({ targetWindow: createCookieWindow().targetWindow });
            const handler = vi.fn<(accepted: boolean) => void>();

            support.onChange(handler);
            support.block();
            support.block();

            expect(support.accepted).toBe(false);
            expect(handler.mock.calls).toStrictEqual([[false]]);
        });

        it('notifies nobody when cookies were already blocked', () => {
            const support = new CookieSupport({ targetWindow: createCookieWindow({ enabled: false }).targetWindow });
            const handler = vi.fn<(accepted: boolean) => void>();

            support.onChange(handler);
            support.block();

            expect(handler).not.toHaveBeenCalled();
        });

        it('stops notifying an unsubscribed handler', () => {
            const support = new CookieSupport({ targetWindow: createCookieWindow().targetWindow });
            const handler = vi.fn<(accepted: boolean) => void>();

            support.onChange(handler)();
            support.block();

            expect(handler).not.toHaveBeenCalled();
        });

        it('reports a throwing subscriber and still notifies the others', () => {
            const failure = new Error('subscriber');
            const onError = vi.fn<(error: unknown) => void>();
            const support = new CookieSupport({ targetWindow: createCookieWindow().targetWindow, onError });
            const after = vi.fn<(accepted: boolean) => void>();

            support.onChange(() => {
                throw failure;
            });
            support.onChange(after);
            support.block();

            expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
            expect(after).toHaveBeenCalledExactlyOnceWith(false);
        });

        it('ignores a throwing error sink', () => {
            const support = new CookieSupport({
                targetWindow: createCookieWindow().targetWindow,
                onError: () => {
                    throw new Error('sink');
                },
            });

            support.onChange(() => {
                throw new Error('subscriber');
            });

            expect(() => {
                support.block();
            }).not.toThrow();
        });

        it('reports a throwing subscriber to the global reportError by default', () => {
            const reportError = vi.fn<(error: unknown) => void>();
            const failure = new Error('subscriber');

            vi.stubGlobal('reportError', reportError);

            const support = new CookieSupport({ targetWindow: createCookieWindow().targetWindow });

            support.onChange(() => {
                throw failure;
            });
            support.block();

            expect(reportError).toHaveBeenCalledExactlyOnceWith(failure);
        });
    });
});
