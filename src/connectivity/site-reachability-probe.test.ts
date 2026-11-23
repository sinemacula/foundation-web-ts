/**
 * Unit tests for site-reachability-probe.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it, vi } from 'vitest';

import { createSiteReachabilityProbe } from './site-reachability-probe';

/**
 * Build a fetch spy answering every request with the given response.
 */
function answering(response: Response) {
    return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(response));
}

describe('createSiteReachabilityProbe', () => {
    it('sends an uncached HEAD that never follows a redirect, numbered per probe', async () => {
        const fetchFn = answering(new Response(null, { status: 200 }));
        const probe = createSiteReachabilityProbe({ url: '/up?v=1', baseUrl: 'https://app.example.com/a/b', fetchFn });
        const { signal } = new AbortController();

        await probe(signal);
        await probe(signal);

        expect(fetchFn.mock.calls).toStrictEqual([
            [
                'https://app.example.com/up?v=1&reachability=1',
                { method: 'HEAD', cache: 'no-store', redirect: 'manual', signal },
            ],
            [
                'https://app.example.com/up?v=1&reachability=2',
                { method: 'HEAD', cache: 'no-store', redirect: 'manual', signal },
            ],
        ]);
    });

    it.each([200, 404, 503])('counts a %s response as reachable', async status => {
        const probe = createSiteReachabilityProbe({ url: '/up', fetchFn: answering(new Response(null, { status })) });

        await expect(probe(new AbortController().signal)).resolves.toBe(true);
    });

    it('counts a redirect as unreachable', async () => {
        const redirect = Object.defineProperty(new Response(null), 'type', { value: 'opaqueredirect' });
        const probe = createSiteReachabilityProbe({ url: '/up', fetchFn: answering(redirect) });

        await expect(probe(new AbortController().signal)).resolves.toBe(false);
    });

    it('rejects when the request fails', async () => {
        const failure = new TypeError('Failed to fetch');
        const probe = createSiteReachabilityProbe({ url: '/up', fetchFn: () => Promise.reject(failure) });

        await expect(probe(new AbortController().signal)).rejects.toBe(failure);
    });

    it('resolves against the global location and uses the global fetch by default', async () => {
        const fetchFn = answering(new Response(null));

        vi.stubGlobal('fetch', fetchFn);

        await createSiteReachabilityProbe({ url: '/up' })(new AbortController().signal);

        expect(fetchFn.mock.calls[0]?.[0]).toBe(new URL('/up?reachability=1', globalThis.location.href).href);
    });
});
