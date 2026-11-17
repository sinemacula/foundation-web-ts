/**
 * Module registry validation, ordering and lifecycle execution.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type {
    RequestInterceptor,
    ResponseErrorHandler,
    UnauthorizedHandler,
} from '@sinemacula/foundation/http/http-client';
import type { ModuleHttpContributions } from '@sinemacula/foundation/http/module-http-contributions';
import type {
    LocaleMessages,
    ModuleBootContext,
    ModuleDefinition,
    ModuleHttpRegistrar,
    ModuleRegisterContext,
} from './module';
import type { TeardownStack } from './teardown-stack';

/**
 * A module list failed registry validation or lifecycle execution.
 */
export class ModuleRegistryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ModuleRegistryError';
    }
}

/**
 * A validated module list in its effective order.
 */
export interface ModuleRegistry {
    /** Modules in declaration order with the fallback module moved last; frozen. */
    readonly modules: readonly ModuleDefinition[];
}

/**
 * Validate a module list and freeze it with the fallback module moved last.
 *
 * @throws {@link ModuleRegistryError} when module names repeat or more than one
 * module declares fallback
 */
export function createModuleRegistry(modules: readonly ModuleDefinition[]): ModuleRegistry {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const definition of modules) {
        if (seen.has(definition.name)) {
            duplicates.add(definition.name);
        }

        seen.add(definition.name);
    }

    if (duplicates.size > 0) {
        const names = [...duplicates]
            .sort()
            .map(name => `"${name}"`)
            .join(', ');

        throw new ModuleRegistryError(`Duplicate module names: ${names}.`);
    }

    const fallbacks = modules.filter(definition => definition.fallback === true);

    if (fallbacks.length > 1) {
        const names = fallbacks.map(definition => `"${definition.name}"`).join(', ');

        throw new ModuleRegistryError(
            `Multiple fallback modules: ${names}; at most one module may own the application catch-all.`,
        );
    }

    const ordered = [...modules.filter(definition => definition.fallback !== true), ...fallbacks];

    return Object.freeze({ modules: Object.freeze(ordered) });
}

/**
 * Run every module's register hook in registry order and return their HTTP
 * contributions, frozen. Each hook's registrar closes when the hook returns.
 *
 * @throws {@link ModuleRegistryError} when the unauthorized handler is set more
 * than once, a register hook returns a promise, or a registrar is used after
 * its hook returned
 */
export function registerModules(
    modules: readonly ModuleDefinition[],
    context: Omit<ModuleRegisterContext, 'http'>,
): ModuleHttpContributions {
    const requestInterceptors: RequestInterceptor[] = [];
    const responseErrorHandlers: ResponseErrorHandler[] = [];

    let onUnauthorized: UnauthorizedHandler | null = null;
    let unauthorizedOwner: string | null = null;

    for (const definition of modules) {
        if (definition.register === undefined) {
            continue;
        }

        let open = true;

        /**
         * Reject a contribution made after the register hook returned.
         */
        const ensureOpen = (): void => {
            if (!open) {
                throw new ModuleRegistryError(
                    `Module "${definition.name}" contributed after its register hook returned; ` +
                        'register hooks must contribute synchronously.',
                );
            }
        };

        const http: ModuleHttpRegistrar = {
            addRequestInterceptor: interceptor => {
                ensureOpen();
                requestInterceptors.push(interceptor);
            },
            setUnauthorizedHandler: handler => {
                ensureOpen();

                if (unauthorizedOwner !== null) {
                    throw new ModuleRegistryError(
                        `Modules "${unauthorizedOwner}" and "${definition.name}" both set the unauthorized handler; ` +
                            'only one refresh authority is allowed.',
                    );
                }

                onUnauthorized = handler;
                unauthorizedOwner = definition.name;
            },
            addResponseErrorHandler: handler => {
                ensureOpen();
                responseErrorHandlers.push(handler);
            },
        };

        let result: unknown;

        try {
            result = definition.register({ ...context, http });
        } finally {
            open = false;
        }

        if (isThenable(result)) {
            // Boot fails on the error below; the hook's own late failure adds nothing.
            Promise.resolve(result).catch(() => undefined);

            throw new ModuleRegistryError(
                `Module "${definition.name}" has an async register hook; register hooks must contribute synchronously.`,
            );
        }
    }

    return Object.freeze({
        requestInterceptors: Object.freeze(requestInterceptors),
        onUnauthorized,
        responseErrorHandlers: Object.freeze(responseErrorHandlers),
    });
}

/**
 * Run every module's boot hook in registry order, pushing each returned
 * teardown onto the caller's stack as soon as its module has booted, so a
 * failed boot leaves the already-booted modules for the caller to roll back.
 */
export async function bootModules(
    modules: readonly ModuleDefinition[],
    context: ModuleBootContext,
    teardowns: TeardownStack,
): Promise<void> {
    for (const definition of modules) {
        const teardown = await definition.boot?.(context);

        if (teardown !== undefined) {
            teardowns.push(teardown);
        }
    }
}

/**
 * Memoised, parallel loading of module translations.
 */
export interface ModuleMessageSource {
    /**
     * Load every module's translations for one locale, keyed by module name.
     */
    messages(locale: string): Promise<Record<string, LocaleMessages>>;
}

/**
 * Build a {@link ModuleMessageSource} that runs module loaders in parallel, at
 * most once per locale, with the same results as `collectModuleMessages`; a
 * rejected load is forgotten so the next request retries it.
 */
export function createModuleMessageSource(modules: readonly ModuleDefinition[]): ModuleMessageSource {
    const cache = new Map<string, Promise<Record<string, LocaleMessages>>>();

    return {
        messages: locale => {
            const cached = cache.get(locale);

            if (cached !== undefined) {
                return cached;
            }

            const loading = loadModuleMessages(modules, locale);

            cache.set(locale, loading);

            loading.catch(() => {
                cache.delete(locale);
            });

            return loading;
        },
    };
}

/**
 * Determine whether a register hook handed back a promise-like value.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
    return typeof (value as Partial<PromiseLike<unknown>> | null | undefined)?.then === 'function';
}

/**
 * Load every module's translations for one locale in parallel, keyed by module
 * name.
 */
async function loadModuleMessages(
    modules: readonly ModuleDefinition[],
    locale: string,
): Promise<Record<string, LocaleMessages>> {
    const loaded = await Promise.all(
        modules.map(async definition => {
            const result = definition.locales === undefined ? null : await definition.locales(locale);

            return [definition.name, result] as const;
        }),
    );

    const messages: Record<string, LocaleMessages> = {};

    for (const [name, result] of loaded) {
        if (result !== null) {
            messages[name] = result;
        }
    }

    return messages;
}
