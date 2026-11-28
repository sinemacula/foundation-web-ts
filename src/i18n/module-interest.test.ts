/**
 * Unit tests for module-interest.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it, vi } from 'vitest';

import { ModuleInterest } from './module-interest';

describe('ModuleInterest', () => {
    it('requires the kept modules and the requested ones once each', () => {
        const interest = new ModuleInterest(['shell']);

        interest.request(['users', 'shell']);
        interest.keep(['home']);

        expect(interest.required()).toEqual(['shell', 'home', 'users']);
    });

    it('requires a module until every request for it is released', () => {
        const interest = new ModuleInterest([]);
        const first = interest.request(['users']);
        const second = interest.request(['users']);

        first();
        first();

        expect(interest.required()).toEqual(['users']);

        second();

        expect(interest.required()).toEqual([]);
    });

    it('settles the waiters of each release', async () => {
        const interest = new ModuleInterest([]);
        const release = interest.request(['users']);
        const waiter = vi.fn();
        const pending = interest.released().then(waiter);

        await Promise.resolve();

        expect(waiter).not.toHaveBeenCalled();

        release();
        await pending;

        expect(waiter).toHaveBeenCalledOnce();

        const next = vi.fn();

        void interest.released().then(next);
        release();
        await Promise.resolve();

        expect(next).not.toHaveBeenCalled();
    });
});
