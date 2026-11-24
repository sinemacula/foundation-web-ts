/**
 * A window whose cookie jar a test controls, for cookie support tests.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

/** How the fake browser treats cookies. */
export interface CookieWindowSetup {
    /** Whether the browser reports cookies enabled. Default true. */
    readonly enabled?: boolean;

    /** Whether the jar keeps written cookies. Default true. */
    readonly keeps?: boolean;

    /** The page's protocol. Default 'https:'. */
    readonly protocol?: string;

    /** Whether reading or writing cookies throws, as in a sandboxed frame. Default false. */
    readonly throws?: boolean;

    /** Cookies the jar already holds. */
    readonly jar?: Readonly<Record<string, string>>;
}

/** The fake window and what it saw. */
export interface CookieWindow {
    /** The window to check cookies through. */
    readonly targetWindow: Window;

    /** Every cookie string written, in order. */
    readonly writes: string[];

    /** The cookies the jar holds. */
    readonly jar: Map<string, string>;
}

/**
 * Build a window over an in-memory cookie jar; its random values are all 35.
 */
export function createCookieWindow(setup: CookieWindowSetup = {}): CookieWindow {
    const writes: string[] = [];
    const jar = new Map(Object.entries(setup.jar ?? {}));

    /** Throw as a sandboxed document does. */
    const guard = (): void => {
        if (setup.throws === true) {
            throw new DOMException('The operation is insecure.', 'SecurityError');
        }
    };

    const document = {
        get cookie(): string {
            guard();

            return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
        },
        set cookie(written: string) {
            guard();
            writes.push(written);

            const [pair = ''] = written.split('; ');
            const [name = '', value = ''] = pair.split('=');

            if (written.includes('Expires=Thu, 01 Jan 1970 00:00:00 GMT')) {
                jar.delete(name);
            } else if (setup.keeps ?? true) {
                jar.set(name, value);
            }
        },
    };
    const targetWindow = {
        navigator: { cookieEnabled: setup.enabled ?? true },
        location: { protocol: setup.protocol ?? 'https:' },
        crypto: {
            getRandomValues: (values: Uint32Array) => values.fill(35),
        },
        document,
    } as unknown as Window;

    return { targetWindow, writes, jar };
}
