/**
 * Reachability probe that asks the site itself whether it still answers.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ReachabilityProbe } from '@sinemacula/foundation/connectivity/confirmed-connectivity-monitor';

/** Options for {@link createSiteReachabilityProbe}. */
export interface SiteReachabilityProbeOptions {
    /** The resource asked, resolved against `baseUrl`; any HTTP status counts as an answer. */
    readonly url: string;

    /** The URL `url` is resolved against; defaults to the global location. */
    readonly baseUrl?: string;

    /** The fetch implementation; defaults to the global fetch. */
    readonly fetchFn?: typeof fetch;
}

/**
 * Build a probe sending an uncached `HEAD` to the site. Any response is an
 * answer, an error status included; a redirect is not, so a captive portal
 * never passes for the site. A service worker must let the request reach the
 * network.
 */
export function createSiteReachabilityProbe(options: SiteReachabilityProbeOptions): ReachabilityProbe {
    const fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    let sequence = 0;

    return async signal => {
        const target = new URL(options.url, options.baseUrl ?? globalThis.location.href);

        target.searchParams.set('reachability', String(++sequence));

        const response = await fetchFn(target.href, {
            method: 'HEAD',
            cache: 'no-store',
            redirect: 'manual',
            signal,
        });

        return response.type !== 'opaqueredirect';
    };
}
