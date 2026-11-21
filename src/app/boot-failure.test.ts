/**
 * Unit tests for boot-failure reporting.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it, vi } from 'vitest';

import { NullErrorReporter } from '@sinemacula/foundation/reporting/null-error-reporter';
import { BootFailureReporter, createBootFailureReference } from './boot-failure';

describe('createBootFailureReference', () => {
    it('formats two groups of four unambiguous characters', () => {
        expect(createBootFailureReference()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    });

    it('maps each random byte onto the alphabet', () => {
        const random = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => {
            (array as Uint8Array).set([0, 1, 31, 32, 255, 18, 10, 30]);

            return array;
        });

        try {
            expect(createBootFailureReference()).toBe('01Z0-ZJAY');
        } finally {
            random.mockRestore();
        }
    });
});

describe('BootFailureReporter', () => {
    const failure = new Error('boot failed');
    const rollbackFailure = new Error('teardown failed');

    it('reports nothing and returns null before a reporter is attached', () => {
        const createReference = vi.fn(() => 'AB12-CD34');
        const rollback = vi.fn(() => [rollbackFailure]);

        expect(new BootFailureReporter(createReference).report(failure, rollback)).toBeNull();
        expect(createReference).not.toHaveBeenCalled();
        expect(rollback).toHaveBeenCalledTimes(1);
    });

    it('reports the failure before running the rollback', () => {
        const reporter = new NullErrorReporter();
        const order: string[] = [];

        vi.spyOn(reporter, 'captureError').mockImplementation((_, context) => {
            order.push(`capture:${String(context?.['source'])}`);
        });

        const failures = new BootFailureReporter(() => 'AB12-CD34');

        failures.attach(reporter);
        failures.report(failure, () => {
            order.push('rollback');

            return [rollbackFailure];
        });

        expect(order).toEqual(['capture:boot', 'rollback', 'capture:boot-rollback']);
    });

    it('reports without a reference when the reference factory throws', () => {
        const reporter = new NullErrorReporter();
        const capture = vi.spyOn(reporter, 'captureError');

        const failures = new BootFailureReporter(() => {
            throw new Error('reference failed');
        });

        failures.attach(reporter);

        expect(failures.report(failure, () => [rollbackFailure])).toBeNull();
        expect(capture.mock.calls).toEqual([
            [failure, { source: 'boot' }],
            [rollbackFailure, { source: 'boot-rollback' }],
        ]);
    });

    it('reports rollback failures without a reference when the failure was not reported', () => {
        const reporter = new NullErrorReporter();
        const capture = vi.spyOn(reporter, 'captureError').mockImplementationOnce(() => {
            throw new Error('reporter failed');
        });

        const failures = new BootFailureReporter(() => 'AB12-CD34');

        failures.attach(reporter);

        expect(failures.report(failure, () => [rollbackFailure])).toBeNull();
        expect(capture).toHaveBeenLastCalledWith(rollbackFailure, { source: 'boot-rollback' });
    });

    it('reports every rollback failure even when the reporter throws on one', () => {
        const reporter = new NullErrorReporter();
        const second = new Error('second teardown failed');
        const capture = vi
            .spyOn(reporter, 'captureError')
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
                throw new Error('reporter failed');
            });

        const failures = new BootFailureReporter(() => 'AB12-CD34');

        failures.attach(reporter);

        expect(failures.report(failure, () => [rollbackFailure, second])).toBe('AB12-CD34');
        expect(capture).toHaveBeenLastCalledWith(second, { source: 'boot-rollback', reference: 'AB12-CD34' });
    });
});
