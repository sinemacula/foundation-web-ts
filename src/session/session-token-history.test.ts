/**
 * Unit tests for session-token-history.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it } from 'vitest';

import type { HttpRequest } from '@sinemacula/foundation/http/http-client';
import { SessionTokenHistory } from './session-token-history';

/**
 * Build a request carrying the given authorization header, if any.
 */
function request(authorization?: string): HttpRequest {
    return {
        method: 'GET',
        url: 'https://api.example/x',
        headers: authorization === undefined ? {} : { authorization },
        body: undefined,
    };
}

describe('SessionTokenHistory', () => {
    it('reports a recorded token the session has since replaced', () => {
        const history = new SessionTokenHistory();

        history.record(request('Bearer old'));

        expect(history.isSuperseded(request('Bearer old'), 'new')).toBe(true);
    });

    it.each<[string, HttpRequest, string | null]>([
        ['the current token', request('Bearer old'), 'old'],
        ['a token while signed out', request('Bearer old'), null],
        ['a token it never recorded', request('Bearer other'), 'new'],
        ['another authorization scheme', request('Basic old'), 'new'],
        ['no authorization', request(), 'new'],
    ])('does not report %s', (_case, sent, current) => {
        const history = new SessionTokenHistory();

        history.record(request('Bearer old'));

        expect(history.isSuperseded(sent, current)).toBe(false);
    });

    it('records nothing for a request without a bearer token', () => {
        const history = new SessionTokenHistory();

        history.record(request('Basic old'));

        expect(history.isSuperseded(request('Bearer old'), 'new')).toBe(false);
    });

    it('forgets the least recently sent token past its capacity', () => {
        const history = new SessionTokenHistory(2);

        history.record(request('Bearer first'));
        history.record(request('Bearer second'));
        history.record(request('Bearer first'));
        history.record(request('Bearer third'));

        expect(history.isSuperseded(request('Bearer first'), 'current')).toBe(true);
        expect(history.isSuperseded(request('Bearer second'), 'current')).toBe(false);
        expect(history.isSuperseded(request('Bearer third'), 'current')).toBe(true);
    });

    it('remembers 32 tokens by default', () => {
        const history = new SessionTokenHistory();

        for (let index = 0; index <= 32; index += 1) {
            history.record(request(`Bearer token-${String(index)}`));
        }

        expect(history.isSuperseded(request('Bearer token-0'), 'current')).toBe(false);
        expect(history.isSuperseded(request('Bearer token-1'), 'current')).toBe(true);
    });
});
