/**
 * Tests for the unit-test network guard.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it } from 'vitest';

describe('network guard', () => {
    it.each([
        ['fetch', () => fetch('https://example.com')],
        ['WebSocket', () => new WebSocket('wss://example.com')],
        ['EventSource', () => new EventSource('https://example.com/stream')],
        ['XMLHttpRequest', () => new XMLHttpRequest()],
        ['navigator.sendBeacon', () => navigator.sendBeacon('https://example.com/beacon')],
    ])('rejects %s', (entryPoint, reach) => {
        expect(reach).toThrow(`Unit tests must not touch the network (${entryPoint}).`);
    });
});
