/**
 * Collects the browser failures that must fail a spec: uncaught page errors,
 * console errors and API requests no mock answered.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { BrowserContext, ConsoleMessage } from '@playwright/test';

import { API_ORIGIN, SERVED_BY_PREVIEW } from './environment';

const FAILED_RESOURCE = /^Failed to load resource: (?:the server responded with a status of (\d{3})|net::)/u;

/** A response a spec provoked on purpose, whose console noise is expected. */
interface ExpectedFailedResource {
    /** The exact URL of the failed resource. */
    readonly url: string;

    /** The HTTP status it was answered with, or null when it failed in transport. */
    readonly status: number | null;
}

/**
 * Records every failure across all tabs of a browser context; a spec passes
 * only when the record is empty at teardown.
 */
export class FailureGuard {
    /** The unexpected failures seen so far, one line each. */
    readonly failures: string[] = [];

    /** Console errors a spec declared expected. */
    private readonly allowedMessages: RegExp[] = [];

    /** Failed responses a mock returned on purpose. */
    private readonly expectedResources: ExpectedFailedResource[] = [];

    /**
     * Watch `context` for page errors and console errors, and route every API
     * request no spec mocked to a recorded failure.
     */
    async install(context: BrowserContext): Promise<void> {
        context.on('weberror', webError => {
            this.failures.push(`page error: ${webError.error().message}`);
        });

        context.on('console', message => {
            if (message.type() === 'error' && !this.isExpected(message)) {
                this.failures.push(`console error: ${message.text()} (${message.location().url})`);
            }
        });

        // Registered first, so it runs last: any matching mock answers first.
        await context.route(`${API_ORIGIN}/**`, route => {
            const request = route.request();

            this.failures.push(`unmocked API request: ${request.method()} ${request.url()}`);

            return route.fulfill({ status: 501, json: { message: 'No mock answered this request.' } });
        });
    }

    /**
     * Expect console errors matching `pattern`, such as a logged boot failure.
     */
    allowConsoleError(pattern: RegExp): void {
        this.allowedMessages.push(pattern);
    }

    /**
     * Expect the browser's console noise for `url` answered with `status`, or
     * failed in transport when `status` is null.
     */
    expectFailedResource(url: string, status: number | null): void {
        this.expectedResources.push({ url, status });
    }

    /**
     * Record a request that broke the API contract a mock enforces.
     */
    contractViolation(description: string): void {
        this.failures.push(`API contract violation: ${description}`);
    }

    /**
     * Whether a console error was declared expected by the spec or a mock.
     */
    private isExpected(message: ConsoleMessage): boolean {
        const text = message.text();

        if (this.allowedMessages.some(pattern => pattern.test(text))) {
            return true;
        }

        const failure = FAILED_RESOURCE.exec(text);

        if (failure === null) {
            return false;
        }

        const status = failure[1] === undefined ? null : Number(failure[1]);
        const url = message.location().url;

        // The dev server has no runtime-env.json; boot uses the build-time env.
        if (!SERVED_BY_PREVIEW && status === 404 && new URL(url).pathname === '/runtime-env.json') {
            return true;
        }

        return this.expectedResources.some(expected => expected.url === url && expected.status === status);
    }
}
