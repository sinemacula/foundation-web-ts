/**
 * Unit tests for module-registry.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { createPinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent } from 'vue';
import { createMemoryHistory } from 'vue-router';

import { ConfigRepository } from '@sinemacula/foundation/config/config-repository';
import { Environment } from '@sinemacula/foundation/config/environment';
import type { HttpClient } from '@sinemacula/foundation/http/http-client';
import { createApplicationI18n } from '../i18n/application-i18n';
import { createApplicationRouter } from '../router/router-factory';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import type {
    LocaleMessages,
    ModuleBootContext,
    ModuleDefinition,
    ModuleHttpRegistrar,
    ModuleRegisterContext,
    ResolvedPlatform,
} from './module';
import {
    ModuleRegistryError,
    bootModules,
    createModuleMessageSource,
    createModuleRegistry,
    registerModules,
} from './module-registry';
import { TeardownStack } from './teardown-stack';

const EmptyComponent = defineComponent({ render: () => null });

/** A promise paired with the callbacks that settle it. */
interface Deferred<T> {
    /** The promise the callbacks settle. */
    readonly promise: Promise<T>;

    /** Fulfil the promise with a value. */
    readonly resolve: (value: T) => void;

    /** Reject the promise with a reason. */
    readonly reject: (reason?: unknown) => void;
}

/** Create a promise the test settles on demand. */
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;

    const promise = new Promise<T>((resolveValue, rejectValue) => {
        resolve = resolveValue;
        reject = rejectValue;
    });

    return { promise, resolve, reject };
}

/** Build the platform seams with inert stand-ins. */
function createPlatform(): ResolvedPlatform {
    return {
        fetchFn: async () => new Response(),
        targetWindow: window,
        targetDocument: document,
        clock: () => 0,
        schedule: () => () => undefined,
    };
}

/** Build an HTTP client stand-in that fails loudly if any method is invoked. */
function createStubHttpClient(): HttpClient {
    /** Reject any call made to the stub. */
    const reject = (): Promise<never> => Promise.reject(new Error('The stub HTTP client must not be called.'));

    return { get: reject, post: reject, put: reject, patch: reject, delete: reject, download: reject };
}

/** Build a register-phase context without the http collector. */
function createRegisterContext(): Omit<ModuleRegisterContext, 'http'> {
    return {
        config: new ConfigRepository({}),
        environment: new Environment({ get: () => undefined }),
        storage: new MemoryStorage(),
        pinia: createPinia(),
        platform: createPlatform(),
    };
}

/** Build a boot-phase context over real but inert collaborators. */
function createBootContext(): ModuleBootContext {
    return {
        app: createApp(EmptyComponent),
        router: createApplicationRouter({ routes: [], history: createMemoryHistory() }),
        pinia: createPinia(),
        i18n: createApplicationI18n('en-GB'),
        http: createStubHttpClient(),
        storage: new MemoryStorage(),
        config: new ConfigRepository({}),
        platform: createPlatform(),
        realtime: null,
    };
}

describe('ModuleRegistryError', () => {
    it('carries the message and a branded name', () => {
        const error = new ModuleRegistryError('boom');

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('ModuleRegistryError');
        expect(error.message).toBe('boom');
    });
});

describe('createModuleRegistry', () => {
    it('returns an empty registry for an empty list', () => {
        expect(createModuleRegistry([]).modules).toStrictEqual([]);
    });

    it('keeps declaration order when no module declares fallback', () => {
        const alphaModule: ModuleDefinition = { name: 'alpha', routes: [] };
        const betaModule: ModuleDefinition = { name: 'beta', routes: [] };
        const gammaModule: ModuleDefinition = { name: 'gamma', routes: [] };

        const registry = createModuleRegistry([alphaModule, betaModule, gammaModule]);

        expect(registry.modules).toStrictEqual([alphaModule, betaModule, gammaModule]);
    });

    it('moves the fallback module last, keeping the rest stable', () => {
        const errorsModule: ModuleDefinition = { name: 'errors', routes: [], fallback: true };
        const alphaModule: ModuleDefinition = { name: 'alpha', routes: [] };
        const betaModule: ModuleDefinition = { name: 'beta', routes: [] };

        const registry = createModuleRegistry([errorsModule, alphaModule, betaModule]);

        expect(registry.modules).toStrictEqual([alphaModule, betaModule, errorsModule]);
    });

    it('leaves a fallback module that is already last in place', () => {
        const alphaModule: ModuleDefinition = { name: 'alpha', routes: [] };
        const errorsModule: ModuleDefinition = { name: 'errors', routes: [], fallback: true };

        const registry = createModuleRegistry([alphaModule, errorsModule]);

        expect(registry.modules).toStrictEqual([alphaModule, errorsModule]);
    });

    it('treats fallback: false as a regular module', () => {
        const alphaModule: ModuleDefinition = { name: 'alpha', routes: [], fallback: false };
        const betaModule: ModuleDefinition = { name: 'beta', routes: [] };

        const registry = createModuleRegistry([alphaModule, betaModule]);

        expect(registry.modules).toStrictEqual([alphaModule, betaModule]);
    });

    it('freezes the registry and its module list', () => {
        const registry = createModuleRegistry([{ name: 'alpha', routes: [] }]);

        expect(Object.isFrozen(registry)).toBe(true);
        expect(Object.isFrozen(registry.modules)).toBe(true);
    });

    it('throws naming a single duplicate module name', () => {
        const modules: ModuleDefinition[] = [
            { name: 'alpha', routes: [] },
            { name: 'alpha', routes: [] },
        ];

        expect(() => createModuleRegistry(modules)).toThrow(ModuleRegistryError);
        expect(() => createModuleRegistry(modules)).toThrow('Duplicate module names: "alpha".');
    });

    it('throws listing every duplicate name sorted, each exactly once', () => {
        const modules: ModuleDefinition[] = [
            { name: 'zulu', routes: [] },
            { name: 'beta', routes: [] },
            { name: 'zulu', routes: [] },
            { name: 'beta', routes: [] },
            { name: 'beta', routes: [] },
            { name: 'alpha', routes: [] },
        ];

        expect(() => createModuleRegistry(modules)).toThrow('Duplicate module names: "beta", "zulu".');
    });

    it('throws naming both fallback modules when two are declared', () => {
        const modules: ModuleDefinition[] = [
            { name: 'errors', routes: [], fallback: true },
            { name: 'alpha', routes: [] },
            { name: 'extra', routes: [], fallback: true },
        ];

        expect(() => createModuleRegistry(modules)).toThrow(ModuleRegistryError);
        expect(() => createModuleRegistry(modules)).toThrow(
            'Multiple fallback modules: "errors", "extra"; at most one module may own the application catch-all.',
        );
    });

    it('throws naming every fallback module when more than two are declared', () => {
        const modules: ModuleDefinition[] = [
            { name: 'one', routes: [], fallback: true },
            { name: 'two', routes: [], fallback: true },
            { name: 'three', routes: [], fallback: true },
        ];

        expect(() => createModuleRegistry(modules)).toThrow(
            'Multiple fallback modules: "one", "two", "three"; at most one module may own the application catch-all.',
        );
    });

    it('reports duplicate names before multiple fallbacks', () => {
        const modules: ModuleDefinition[] = [
            { name: 'errors', routes: [], fallback: true },
            { name: 'errors', routes: [], fallback: true },
        ];

        expect(() => createModuleRegistry(modules)).toThrow('Duplicate module names: "errors".');
    });
});

describe('registerModules', () => {
    it('returns empty contributions when no module registers', () => {
        const contributions = registerModules([{ name: 'plain', routes: [] }], createRegisterContext());

        expect(contributions.requestInterceptors).toStrictEqual([]);
        expect(contributions.onUnauthorized).toBeNull();
        expect(contributions.responseErrorHandlers).toStrictEqual([]);
    });

    it('freezes the contributions and both collected lists', () => {
        const contributions = registerModules([], createRegisterContext());

        expect(Object.isFrozen(contributions)).toBe(true);
        expect(Object.isFrozen(contributions.requestInterceptors)).toBe(true);
        expect(Object.isFrozen(contributions.responseErrorHandlers)).toBe(true);
    });

    it('runs register hooks sequentially in registry order, skipping hookless modules', () => {
        const order: string[] = [];

        const modules: ModuleDefinition[] = [
            { name: 'alpha', routes: [], register: () => order.push('alpha') },
            { name: 'beta', routes: [] },
            { name: 'gamma', routes: [], register: () => order.push('gamma') },
        ];

        registerModules(modules, createRegisterContext());

        expect(order).toStrictEqual(['alpha', 'gamma']);
    });

    it('passes the shared context values through to each register hook', () => {
        const context = createRegisterContext();

        let received: ModuleRegisterContext | undefined;

        registerModules(
            [
                {
                    name: 'alpha',
                    routes: [],
                    register: registerContext => {
                        received = registerContext;
                    },
                },
            ],
            context,
        );

        expect(received?.config).toBe(context.config);
        expect(received?.environment).toBe(context.environment);
        expect(received?.storage).toBe(context.storage);
        expect(received?.pinia).toBe(context.pinia);
        expect(received?.platform).toBe(context.platform);
        expect(typeof received?.http.addRequestInterceptor).toBe('function');
        expect(typeof received?.http.setUnauthorizedHandler).toBe('function');
        expect(typeof received?.http.addResponseErrorHandler).toBe('function');
    });

    it('collects request interceptors in registration order across modules', () => {
        const interceptorA = vi.fn();
        const interceptorB = vi.fn();
        const interceptorC = vi.fn();

        const modules: ModuleDefinition[] = [
            {
                name: 'alpha',
                routes: [],
                register: ({ http }) => {
                    http.addRequestInterceptor(interceptorA);
                    http.addRequestInterceptor(interceptorB);
                },
            },
            {
                name: 'beta',
                routes: [],
                register: ({ http }) => {
                    http.addRequestInterceptor(interceptorC);
                },
            },
        ];

        const contributions = registerModules(modules, createRegisterContext());

        expect(contributions.requestInterceptors).toStrictEqual([interceptorA, interceptorB, interceptorC]);
    });

    it('collects response error handlers in registration order across modules', () => {
        const handlerA = vi.fn();
        const handlerB = vi.fn();

        const modules: ModuleDefinition[] = [
            {
                name: 'alpha',
                routes: [],
                register: ({ http }) => {
                    http.addResponseErrorHandler(handlerA);
                },
            },
            {
                name: 'beta',
                routes: [],
                register: ({ http }) => {
                    http.addResponseErrorHandler(handlerB);
                },
            },
        ];

        const contributions = registerModules(modules, createRegisterContext());

        expect(contributions.responseErrorHandlers).toStrictEqual([handlerA, handlerB]);
    });

    it('records the unauthorized handler set by a single module', () => {
        const handler = vi.fn(async () => true);

        const modules: ModuleDefinition[] = [
            {
                name: 'session',
                routes: [],
                register: ({ http }) => {
                    http.setUnauthorizedHandler(handler);
                },
            },
        ];

        const contributions = registerModules(modules, createRegisterContext());

        expect(contributions.onUnauthorized).toBe(handler);
    });

    it('throws naming both modules when a second module sets the unauthorized handler', () => {
        const modules: ModuleDefinition[] = [
            {
                name: 'session',
                routes: [],
                register: ({ http }) => {
                    http.setUnauthorizedHandler(async () => true);
                },
            },
            {
                name: 'other',
                routes: [],
                register: ({ http }) => {
                    http.setUnauthorizedHandler(async () => false);
                },
            },
        ];

        expect(() => registerModules(modules, createRegisterContext())).toThrow(ModuleRegistryError);
        expect(() => registerModules(modules, createRegisterContext())).toThrow(
            'Modules "session" and "other" both set the unauthorized handler; only one refresh authority is allowed.',
        );
    });

    it('throws naming the module twice when it sets the unauthorized handler twice', () => {
        const modules: ModuleDefinition[] = [
            {
                name: 'session',
                routes: [],
                register: ({ http }) => {
                    http.setUnauthorizedHandler(async () => true);
                    http.setUnauthorizedHandler(async () => false);
                },
            },
        ];

        expect(() => registerModules(modules, createRegisterContext())).toThrow(
            'Modules "session" and "session" both set the unauthorized handler; only one refresh authority is allowed.',
        );
    });

    it('rejects an async register hook before running later hooks', async () => {
        const later = vi.fn();
        const settled = deferred<undefined>();
        const modules: ModuleDefinition[] = [
            {
                name: 'session',
                routes: [],
                register: async ({ http }) => {
                    await settled.promise;
                    http.setUnauthorizedHandler(async () => true);
                },
            },
            { name: 'other', routes: [], register: later },
        ];

        expect(() => registerModules(modules, createRegisterContext())).toThrow(
            new ModuleRegistryError(
                'Module "session" has an async register hook; register hooks must contribute synchronously.',
            ),
        );
        expect(later).not.toHaveBeenCalled();

        settled.resolve(undefined);
        await settled.promise;
    });

    it.each([
        ['addRequestInterceptor', (http: ModuleHttpRegistrar) => http.addRequestInterceptor(request => request)],
        ['setUnauthorizedHandler', (http: ModuleHttpRegistrar) => http.setUnauthorizedHandler(async () => true)],
        ['addResponseErrorHandler', (http: ModuleHttpRegistrar) => http.addResponseErrorHandler(() => undefined)],
    ])('rejects %s once the register hook has returned', (_label, contribute) => {
        let retained: ModuleHttpRegistrar | null = null;
        const contributions = registerModules(
            [
                {
                    name: 'late',
                    routes: [],
                    register: ({ http }) => {
                        retained = http;
                    },
                },
            ],
            createRegisterContext(),
        );

        expect(() => {
            contribute(retained as unknown as ModuleHttpRegistrar);
        }).toThrow(
            new ModuleRegistryError(
                'Module "late" contributed after its register hook returned; ' +
                    'register hooks must contribute synchronously.',
            ),
        );
        expect(contributions).toStrictEqual({
            requestInterceptors: [],
            onUnauthorized: null,
            responseErrorHandlers: [],
        });
    });

    it('closes a registrar even when its register hook throws', () => {
        let retained: ModuleHttpRegistrar | null = null;
        const failure = new Error('register failed');

        expect(() =>
            registerModules(
                [
                    {
                        name: 'broken',
                        routes: [],
                        register: ({ http }) => {
                            retained = http;
                            throw failure;
                        },
                    },
                ],
                createRegisterContext(),
            ),
        ).toThrow(failure);
        expect(() => {
            (retained as unknown as ModuleHttpRegistrar).addRequestInterceptor(request => request);
        }).toThrow(ModuleRegistryError);
    });
});

describe('bootModules', () => {
    it('pushes nothing when no module boots', async () => {
        const teardowns = new TeardownStack();

        await bootModules([{ name: 'plain', routes: [] }], createBootContext(), teardowns);

        expect(teardowns.drain()).toStrictEqual([]);
    });

    it('passes the boot context to every boot hook exactly once', async () => {
        const context = createBootContext();
        const bootA = vi.fn();
        const bootB = vi.fn();

        await bootModules(
            [
                { name: 'alpha', routes: [], boot: bootA },
                { name: 'beta', routes: [], boot: bootB },
            ],
            context,
            new TeardownStack(),
        );

        expect(bootA).toHaveBeenCalledOnce();
        expect(bootA).toHaveBeenCalledWith(context);
        expect(bootB).toHaveBeenCalledOnce();
        expect(bootB).toHaveBeenCalledWith(context);
    });

    it('skips modules without a boot hook', async () => {
        const boot = vi.fn();

        await bootModules(
            [
                { name: 'plain', routes: [] },
                { name: 'booted', routes: [], boot },
            ],
            createBootContext(),
            new TeardownStack(),
        );

        expect(boot).toHaveBeenCalledOnce();
    });

    it('awaits each boot before starting the next', async () => {
        const order: string[] = [];
        const { promise, resolve } = deferred<undefined>();

        const modules: ModuleDefinition[] = [
            {
                name: 'alpha',
                routes: [],
                boot: async () => {
                    order.push('alpha:start');
                    await promise;
                    order.push('alpha:end');

                    return undefined;
                },
            },
            {
                name: 'beta',
                routes: [],
                boot: () => {
                    order.push('beta:start');

                    return undefined;
                },
            },
        ];

        const pending = bootModules(modules, createBootContext(), new TeardownStack());

        expect(order).toStrictEqual(['alpha:start']);

        resolve(undefined);
        await pending;

        expect(order).toStrictEqual(['alpha:start', 'alpha:end', 'beta:start']);
    });

    it('pushes returned teardowns so the stack disposes them LIFO, skipping undefined', async () => {
        const order: string[] = [];
        const teardowns = new TeardownStack();

        const modules: ModuleDefinition[] = [
            { name: 'alpha', routes: [], boot: () => () => order.push('alpha') },
            { name: 'beta', routes: [], boot: async () => () => order.push('beta') },
            { name: 'gamma', routes: [], boot: () => undefined },
            { name: 'delta', routes: [], boot: () => () => order.push('delta') },
        ];

        await bootModules(modules, createBootContext(), teardowns);

        expect(order).toStrictEqual([]);

        teardowns.dispose();

        expect(order).toStrictEqual(['delta', 'beta', 'alpha']);
    });

    it('still runs the earlier teardowns when a later one throws', async () => {
        const order: string[] = [];
        const failure = new Error('beta teardown failed');
        const teardowns = new TeardownStack();

        const modules: ModuleDefinition[] = [
            { name: 'alpha', routes: [], boot: () => () => order.push('alpha') },
            {
                name: 'beta',
                routes: [],
                boot: () => () => {
                    throw failure;
                },
            },
            { name: 'gamma', routes: [], boot: () => () => order.push('gamma') },
        ];

        await bootModules(modules, createBootContext(), teardowns);

        expect(() => {
            teardowns.dispose();
        }).toThrow(failure);
        expect(order).toStrictEqual(['gamma', 'alpha']);
    });

    it.each([
        ['rejects', (failure: Error) => () => Promise.reject(failure)],
        [
            'throws synchronously',
            (failure: Error) => () => {
                throw failure;
            },
        ],
    ])('rethrows when a boot %s, leaving the booted modules on the stack', async (_label, failing) => {
        const order: string[] = [];
        const failure = new Error('gamma failed to boot');
        const teardowns = new TeardownStack();
        const delta = vi.fn();

        const modules: ModuleDefinition[] = [
            { name: 'alpha', routes: [], boot: () => () => order.push('alpha') },
            { name: 'beta', routes: [], boot: () => () => order.push('beta') },
            { name: 'gamma', routes: [], boot: failing(failure) },
            { name: 'delta', routes: [], boot: delta },
        ];

        await expect(bootModules(modules, createBootContext(), teardowns)).rejects.toBe(failure);

        expect(order).toStrictEqual([]);
        expect(delta).not.toHaveBeenCalled();

        teardowns.dispose();

        expect(order).toStrictEqual(['beta', 'alpha']);
    });
});

describe('createModuleMessageSource', () => {
    it('resolves an empty record when no modules are given', async () => {
        const source = createModuleMessageSource([]);

        expect(await source.messages('en-GB')).toStrictEqual({});
    });

    it('namespaces loaded messages under module names in registry order', async () => {
        const modules: ModuleDefinition[] = [
            { name: 'alpha', routes: [], locales: async () => ({ hello: 'world' }) },
            { name: 'beta', routes: [], locales: async () => ({ bye: 'now' }) },
        ];

        const result = await createModuleMessageSource(modules).messages('en-GB');

        expect(result).toStrictEqual({ alpha: { hello: 'world' }, beta: { bye: 'now' } });
        expect(Object.keys(result)).toStrictEqual(['alpha', 'beta']);
    });

    it('skips modules without a loader and modules whose loader returns null', async () => {
        const modules: ModuleDefinition[] = [
            { name: 'alpha', routes: [], locales: async () => ({ key: 'value' }) },
            { name: 'beta', routes: [], locales: async () => null },
            { name: 'gamma', routes: [] },
        ];

        const result = await createModuleMessageSource(modules).messages('en-GB');

        expect(result).toStrictEqual({ alpha: { key: 'value' } });
    });

    it('passes the requested locale to every loader', async () => {
        const loader = vi.fn(async () => ({ key: 'value' }));
        const source = createModuleMessageSource([{ name: 'alpha', routes: [], locales: loader }]);

        await source.messages('fr-FR');

        expect(loader).toHaveBeenCalledOnce();
        expect(loader).toHaveBeenCalledWith('fr-FR');
    });

    it('starts every loader before any has resolved', async () => {
        const { promise, resolve } = deferred<LocaleMessages | null>();
        const loaderA = vi.fn(() => promise);
        const loaderB = vi.fn(async () => ({ b: 'two' }));

        const source = createModuleMessageSource([
            { name: 'alpha', routes: [], locales: loaderA },
            { name: 'beta', routes: [], locales: loaderB },
        ]);

        const pending = source.messages('en-GB');

        expect(loaderA).toHaveBeenCalledOnce();
        expect(loaderB).toHaveBeenCalledOnce();

        resolve({ a: 'one' });

        expect(await pending).toStrictEqual({ alpha: { a: 'one' }, beta: { b: 'two' } });
    });

    it('memoises per locale, sharing one load across repeat calls', async () => {
        const loader = vi.fn(async () => ({ key: 'value' }));
        const source = createModuleMessageSource([{ name: 'alpha', routes: [], locales: loader }]);

        const first = source.messages('en-GB');
        const second = source.messages('en-GB');

        expect(second).toBe(first);
        expect(await first).toStrictEqual({ alpha: { key: 'value' } });

        await source.messages('en-GB');

        expect(loader).toHaveBeenCalledOnce();
    });

    it('loads each locale independently, once per locale', async () => {
        const loader = vi.fn(async (locale: string) => ({ locale }));
        const source = createModuleMessageSource([{ name: 'alpha', routes: [], locales: loader }]);

        expect(await source.messages('en-GB')).toStrictEqual({ alpha: { locale: 'en-GB' } });
        expect(await source.messages('fr-FR')).toStrictEqual({ alpha: { locale: 'fr-FR' } });
        expect(await source.messages('fr-FR')).toStrictEqual({ alpha: { locale: 'fr-FR' } });

        expect(loader).toHaveBeenCalledTimes(2);
        expect(loader).toHaveBeenNthCalledWith(1, 'en-GB');
        expect(loader).toHaveBeenNthCalledWith(2, 'fr-FR');
    });

    it('retries a locale whose load rejected', async () => {
        const failure = new Error('chunk failed');
        const loader = vi
            .fn<(locale: string) => Promise<LocaleMessages | null>>()
            .mockRejectedValueOnce(failure)
            .mockResolvedValue({ key: 'value' });
        const source = createModuleMessageSource([{ name: 'alpha', routes: [], locales: loader }]);

        await expect(source.messages('en-GB')).rejects.toBe(failure);
        expect(await source.messages('en-GB')).toStrictEqual({ alpha: { key: 'value' } });
        expect(await source.messages('en-GB')).toStrictEqual({ alpha: { key: 'value' } });
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it('shares a pending load that later rejects with every caller that joined it', async () => {
        const { promise, reject } = deferred<LocaleMessages | null>();
        const loader = vi.fn(() => promise);
        const source = createModuleMessageSource([{ name: 'alpha', routes: [], locales: loader }]);

        const first = source.messages('en-GB');
        const second = source.messages('en-GB');

        reject(new Error('offline'));

        await expect(first).rejects.toThrow('offline');
        expect(second).toBe(first);
        expect(loader).toHaveBeenCalledOnce();
    });
});
