/**
 * Unit tests for teardown-stack.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it } from 'vitest';

import { TeardownStack } from './teardown-stack';

/**
 * Build a stack whose teardowns record their name, throwing for the named ones.
 */
function recordingStack(names: readonly string[], failing: readonly string[] = []) {
    const order: string[] = [];
    const errors = new Map(failing.map(name => [name, new Error(`${name} failed`)]));
    const stack = new TeardownStack();

    for (const name of names) {
        stack.push(() => {
            order.push(name);

            const error = errors.get(name);

            if (error !== undefined) {
                throw error;
            }
        });
    }

    return { order, errors, stack };
}

describe('TeardownStack', () => {
    it('runs teardowns newest first', () => {
        const { order, stack } = recordingStack(['a', 'b', 'c']);

        stack.dispose();

        expect(order).toEqual(['c', 'b', 'a']);
    });

    it('runs every teardown once and forgets them', () => {
        const { order, stack } = recordingStack(['a', 'b']);

        stack.dispose();
        stack.dispose();

        expect(order).toEqual(['b', 'a']);
    });

    it('keeps going past a failing teardown and rethrows that failure unchanged', () => {
        const { order, errors, stack } = recordingStack(['a', 'b', 'c'], ['b']);

        expect(() => {
            stack.dispose();
        }).toThrow(errors.get('b'));
        expect(order).toEqual(['c', 'b', 'a']);
    });

    it('aggregates several failures in the order they were thrown', () => {
        const { order, errors, stack } = recordingStack(['a', 'b', 'c'], ['a', 'c']);

        let thrown: unknown;

        try {
            stack.dispose();
        } catch (error) {
            thrown = error;
        }

        expect(order).toEqual(['c', 'b', 'a']);
        expect(thrown).toBeInstanceOf(AggregateError);
        expect((thrown as AggregateError).errors).toEqual([errors.get('c'), errors.get('a')]);
        expect((thrown as AggregateError).message).toBe('2 teardowns failed.');
    });

    it('returns the failures from drain without throwing', () => {
        const { order, errors, stack } = recordingStack(['a', 'b'], ['a', 'b']);

        expect(stack.drain()).toEqual([errors.get('b'), errors.get('a')]);
        expect(order).toEqual(['b', 'a']);
        expect(stack.drain()).toEqual([]);
    });
});
