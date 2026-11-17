/**
 * Network-boundary API fake for end-to-end specs; no real backend is used.
 *
 * Every mock is registered on the browser context, so it answers every tab.
 * Protected endpoints honour only bearer tokens the fake issued and has not
 * revoked, and requests that break the wire contract are recorded as failures.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { BrowserContext, BrowserContextOptions, Page, Request, Route } from '@playwright/test';

import { API_ORIGIN, BASE_URL } from './environment';
import type { FailureGuard } from './failure-guard';

/** The storage key the session module persists its snapshot under. */
export const SESSION_STORAGE_KEY = 'auth.session';

/** The token pair of a persisted session. */
export interface SessionTokens {
    /** The bearer access token. */
    readonly accessToken: string;

    /** The refresh token. */
    readonly refreshToken: string;

    /** The access token expiry, or null for none. */
    readonly expiresAtEpochMs: number | null;
}

/** The session every signed-in spec starts from. */
export const SEEDED_SESSION: SessionTokens = {
    accessToken: 'e2e-seeded-access-token',
    refreshToken: 'e2e-seeded-refresh-token',
    expiresAtEpochMs: null,
};

/** One API request the fake answered. */
export interface RecordedRequest {
    /** The HTTP method. */
    readonly method: string;

    /** The request URL. */
    readonly url: URL;

    /** The Authorization header, or null when absent. */
    readonly authorization: string | null;

    /** The parsed JSON body, or null when there is none. */
    readonly body: unknown;
}

/** The reply a mock settles a request with. */
interface Reply {
    /** The HTTP status. */
    readonly status: number;

    /** The JSON body, if any. */
    readonly json?: unknown;
}

/** A browser storage state a context can start from. */
type StorageState = Exclude<BrowserContextOptions['storageState'], string | undefined>;

/** The session snapshot the app persists. */
interface PersistedSnapshot {
    /** The persisted session, or null once signed out. */
    readonly session?: {
        /** The persisted token pair. */
        readonly tokens: SessionTokens;
    } | null;
}

/** The permissions the default fake user holds. */
const DEFAULT_PERMISSIONS: readonly string[] = ['users.view'];

/**
 * Build the browser storage state holding `tokens` as a persisted session.
 */
export function signedInStorageState(tokens: SessionTokens = SEEDED_SESSION): StorageState {
    return {
        cookies: [],
        origins: [
            {
                origin: BASE_URL,
                localStorage: [
                    {
                        name: SESSION_STORAGE_KEY,
                        value: JSON.stringify({ revision: 1, session: { lineage: 'e2e-seeded', tokens } }),
                    },
                ],
            },
        ],
    };
}

/**
 * Build a record from `[key, value]` pairs, keeping snake_case wire names out
 * of object-literal keys.
 */
function wire(entries: ReadonlyArray<readonly [string, unknown]>): Record<string, unknown> {
    return Object.fromEntries(entries);
}

/** Build one raw user row for the mocked users-list response. */
function userRow(id: string, fullName: string): Record<string, unknown> {
    return wire([
        ['id', id],
        ['full_name', fullName],
        ['email', `${id}@example.com`],
        ['created_at', '2026-01-01 00:00:00'],
    ]);
}

/**
 * Whether `body` is an object with exactly `keys`, each holding a non-empty
 * string.
 */
function hasStringFields(body: unknown, keys: readonly string[]): boolean {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return false;
    }

    const entries = Object.entries(body);

    return (
        entries.length === keys.length &&
        entries.every(([key, value]) => keys.includes(key) && typeof value === 'string' && value !== '')
    );
}

/**
 * Parse a request body as JSON, or null when there is none.
 */
function parseBody(request: Request): unknown {
    const text = request.postData();

    if (text === null || text === '') {
        return null;
    }

    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

/**
 * A stateful fake of the playground's API, bound to one browser context.
 */
export class MockApi {
    /** Every request a mock answered, in arrival order. */
    readonly requests: RecordedRequest[] = [];

    /** The access tokens currently honoured. */
    private readonly accessTokens = new Set<string>();

    /** The refresh tokens that may still be redeemed once. */
    private readonly refreshTokens = new Set<string>();

    /** How many token pairs the fake has issued. */
    private issued = 0;

    constructor(
        private readonly context: BrowserContext,
        private readonly guard: FailureGuard,
    ) {}

    /**
     * Honour `tokens`, as though the API had issued them before the spec.
     */
    trust(tokens: SessionTokens): void {
        this.accessTokens.add(tokens.accessToken);
        this.refreshTokens.add(tokens.refreshToken);
    }

    /**
     * Stop honouring an access token, as when it expires server side.
     */
    expireAccessToken(accessToken: string): void {
        this.accessTokens.delete(accessToken);
    }

    /**
     * The requests answered for `pathname`, optionally of one method.
     */
    requestsTo(pathname: string, method?: string): RecordedRequest[] {
        return this.requests.filter(
            request => request.url.pathname === pathname && (method === undefined || request.method === method),
        );
    }

    /**
     * Serve GET users/self as a user holding `permissions`.
     */
    async currentUser(permissions: readonly string[] = DEFAULT_PERMISSIONS): Promise<void> {
        await this.endpoint('GET', '/users/self', request =>
            this.protectedReply(request, {
                status: 200,
                json: {
                    data: wire([
                        ['id', 'user-1'],
                        ['first_name', 'E2E'],
                        ['last_name', 'User'],
                        ['full_name', 'E2E User'],
                        ['email', 'e2e@example.com'],
                        ['permissions', permissions],
                    ]),
                },
            }),
        );
    }

    /**
     * Serve POST auth/sign-in with a fresh session, then the current user.
     */
    async signInSucceeds(): Promise<void> {
        await this.signIn(() => ({ status: 200, json: this.issueSession() }));
        await this.currentUser();
    }

    /**
     * Serve POST auth/sign-in with an invalid-credentials rejection.
     */
    async signInFails(): Promise<void> {
        await this.signIn(() => ({ status: 401, json: { message: 'Invalid credentials.' } }));
    }

    /**
     * Serve POST auth/sign-in with a pending session that owes a second factor.
     */
    async signInRequiresInteraction(): Promise<void> {
        await this.signIn(() => ({
            status: 200,
            json: wire([
                ['pending_credential', 'e2e-pending-credential'],
                ['requires', ['mfa']],
            ]),
        }));
    }

    /**
     * Serve POST auth/refresh, redeeming each refresh token once for a new pair
     * and refusing any other.
     */
    async refreshRotates(): Promise<void> {
        await this.endpoint('POST', '/auth/refresh', request => {
            const refreshToken = this.refreshTokenIn(request);

            if (refreshToken === null) {
                return { status: 422, json: { message: 'A refresh token is required.' } };
            }

            if (!this.refreshTokens.delete(refreshToken)) {
                return { status: 401, json: { message: 'The refresh token is invalid.' } };
            }

            return { status: 200, json: this.issueSession() };
        });
    }

    /**
     * Serve POST auth/refresh with a refusal.
     */
    async refreshRefused(): Promise<void> {
        await this.endpoint('POST', '/auth/refresh', request => {
            this.refreshTokenIn(request);

            return { status: 401, json: { message: 'The refresh token is invalid.' } };
        });
    }

    /**
     * Serve POST auth/logout, revoking the presented bearer and refresh tokens.
     */
    async logout(): Promise<void> {
        await this.endpoint('POST', '/auth/logout', request =>
            this.protectedReply(request, { status: 204 }, token => {
                const refreshToken = this.refreshTokenIn(request);

                this.accessTokens.delete(token);

                if (refreshToken !== null) {
                    this.refreshTokens.delete(refreshToken);
                }
            }),
        );
    }

    /**
     * Serve GET users with two pages of rows, the second for `page=2`.
     */
    async usersList(): Promise<void> {
        await this.endpoint('GET', '/users', request => {
            const isSecondPage = request.url.searchParams.get('page') === '2';

            return this.protectedReply(request, {
                status: 200,
                json: isSecondPage
                    ? {
                          data: [userRow('user-3', 'Carol Page Two'), userRow('user-4', 'Dave Page Two')],
                          meta: wire([
                              ['total', 27],
                              ['count', 2],
                              ['continue', false],
                          ]),
                      }
                    : {
                          data: [userRow('user-1', 'Alice Example'), userRow('user-2', 'Bob Example')],
                          meta: wire([
                              ['total', 27],
                              ['count', 25],
                              ['continue', true],
                          ]),
                      },
            });
        });
    }

    /**
     * Serve GET users with no rows.
     */
    async usersListEmpty(): Promise<void> {
        await this.endpoint('GET', '/users', request =>
            this.protectedReply(request, {
                status: 200,
                json: {
                    data: [],
                    meta: wire([
                        ['total', 0],
                        ['count', 0],
                        ['continue', false],
                    ]),
                },
            }),
        );
    }

    /**
     * Serve GET users with a 500, which the default error handler raises as a
     * toast.
     */
    async usersListServerError(): Promise<void> {
        await this.endpoint('GET', '/users', request =>
            this.protectedReply(request, { status: 500, json: { message: 'Server error.' } }),
        );
    }

    /**
     * Drop the next GET users request at the transport layer, as when the
     * network is down; later requests fall through to earlier mocks.
     */
    async usersListDisconnectedOnce(): Promise<void> {
        let dropped = false;

        await this.context.route(
            url => url.origin === API_ORIGIN && url.pathname === '/users',
            route => {
                if (dropped || route.request().method() !== 'GET') {
                    return route.fallback();
                }

                dropped = true;
                this.guard.expectFailedResource(route.request().url(), null);

                return route.abort('internetdisconnected');
            },
        );
    }

    /**
     * Register POST auth/sign-in, checking the credentials body first.
     */
    private async signIn(reply: () => Reply): Promise<void> {
        await this.endpoint('POST', '/auth/sign-in', request => {
            if (!hasStringFields(request.body, ['email', 'password', 'platform'])) {
                this.guard.contractViolation(`sign-in body ${JSON.stringify(request.body)}`);

                return { status: 422, json: { message: 'Malformed sign-in.' } };
            }

            return reply();
        });
    }

    /**
     * Read the refresh token from a refresh or logout body, recording a
     * contract violation when the body is malformed.
     */
    private refreshTokenIn(request: RecordedRequest): string | null {
        if (!hasStringFields(request.body, ['refresh_token'])) {
            this.guard.contractViolation(`${request.url.pathname} body ${JSON.stringify(request.body)}`);

            return null;
        }

        return (request.body as Record<string, string>)['refresh_token'] ?? null;
    }

    /**
     * Answer with `reply` when the request carries an honoured bearer token,
     * after running `accepted` with it, and with a 401 otherwise.
     */
    private protectedReply(request: RecordedRequest, reply: Reply, accepted?: (token: string) => void): Reply {
        const token = /^Bearer (.+)$/u.exec(request.authorization ?? '')?.[1];

        if (token === undefined || !this.accessTokens.has(token)) {
            return { status: 401, json: { message: 'Unauthenticated.' } };
        }

        accepted?.(token);

        return reply;
    }

    /**
     * Issue and honour a new token pair, in the session gateway's wire shape.
     */
    private issueSession(): Record<string, unknown> {
        this.issued += 1;

        const accessToken = `e2e-access-token-${this.issued}`;
        const refreshToken = `e2e-refresh-token-${this.issued}`;

        this.accessTokens.add(accessToken);
        this.refreshTokens.add(refreshToken);

        return wire([
            ['access_token', accessToken],
            ['refresh_token', refreshToken],
            ['expires_in', 3600],
        ]);
    }

    /**
     * Route `method` requests for exactly `pathname` on the API origin to
     * `handle`, recording each one; other methods fall through.
     */
    private async endpoint(
        method: string,
        pathname: string,
        handle: (request: RecordedRequest) => Reply,
    ): Promise<void> {
        await this.context.route(
            url => url.origin === API_ORIGIN && url.pathname === pathname,
            async (route: Route) => {
                const request = route.request();

                if (request.method() !== method) {
                    return route.fallback();
                }

                const recorded: RecordedRequest = {
                    method,
                    url: new URL(request.url()),
                    authorization: await request.headerValue('authorization'),
                    body: parseBody(request),
                };

                this.requests.push(recorded);

                const reply = handle(recorded);

                if (reply.status >= 400) {
                    this.guard.expectFailedResource(request.url(), reply.status);
                }

                return reply.json === undefined
                    ? route.fulfill({ status: reply.status })
                    : route.fulfill({ status: reply.status, json: reply.json });
            },
        );
    }
}

/**
 * Read the token pair the app persisted in `page`, or null when it holds none.
 */
export async function storedTokens(page: Page): Promise<SessionTokens | null> {
    const raw = await page.evaluate(key => window.localStorage.getItem(key), SESSION_STORAGE_KEY);

    if (raw === null) {
        return null;
    }

    const snapshot = JSON.parse(raw) as PersistedSnapshot;

    return snapshot.session?.tokens ?? null;
}
