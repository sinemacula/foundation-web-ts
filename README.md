<h1 align="center">Foundation Web</h1>

<div align="center">

[![Latest Stable Version](https://img.shields.io/npm/v/@sinemacula/foundation-web.svg)](https://www.npmjs.com/package/@sinemacula/foundation-web)
[![Node Version](https://img.shields.io/node/v/@sinemacula/foundation-web.svg)](https://www.npmjs.com/package/@sinemacula/foundation-web)
[![Build Status](https://github.com/sinemacula/foundation-web-ts/actions/workflows/tests.yml/badge.svg?branch=master)](https://github.com/sinemacula/foundation-web-ts/actions/workflows/tests.yml)
[![Quality Gates](https://github.com/sinemacula/foundation-web-ts/actions/workflows/quality-gates.yml/badge.svg?branch=master)](https://github.com/sinemacula/foundation-web-ts/actions/workflows/quality-gates.yml)
[![Maintainability](https://qlty.sh/gh/sinemacula/projects/foundation-web-ts/maintainability.svg)](https://qlty.sh/gh/sinemacula/projects/foundation-web-ts)
[![Code Coverage](https://qlty.sh/gh/sinemacula/projects/foundation-web-ts/coverage.svg)](https://qlty.sh/gh/sinemacula/projects/foundation-web-ts)
[![Total Downloads](https://img.shields.io/npm/dt/@sinemacula/foundation-web.svg)](https://www.npmjs.com/package/@sinemacula/foundation-web)
[![License](https://img.shields.io/github/license/sinemacula/foundation-web-ts.svg)](LICENSE)

</div>

`@sinemacula/foundation-web` is the Vue kernel Sine Macula web applications are built on. It layers the browser and Vue
bindings - the composition root, feature modules, routing, i18n, the session module, realtime and release monitoring -
over the platform-agnostic `@sinemacula/foundation`, with no product code and no UI.

The playground application under `playground/` is the reference consumer: it shows how a real product wires the
kernel, and is the template consuming apps follow.

## How It Works

An application hands `createFoundationWebApp` its root component, an ordered list of feature modules and its
configuration. The preset boots the foundation core, binds it to Vue, Vue Router and vue-i18n, and installs the browser
adapters and services below.

| Area                 | What it provides                                                                                                      | Port / service                    | Vue       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------- |
| `src/activity/`      | Detects when the user has stopped interacting, for policies like auto-logout                                          | `IdleMonitor` (no port)           | no        |
| `src/app/`           | The composition root: `createFoundationWebApp` wires every subsystem in order, plus the service holders and accessors | `createFoundationWebApp`          | runtime   |
| `src/composables/`   | Reusable Vue composables: focus trap, pagination, route-query state                                                   | -                                 | runtime   |
| `src/config/`        | The web environment over build-time variables and the runtime document                                                | `EnvironmentSource`               | no        |
| `src/connectivity/`  | The browser online/offline adapter of the foundation connectivity port                                                | `ConnectivityMonitor`             | no        |
| `src/feature-flags/` | The `useFeatureFlag` composable over the foundation feature-flag provider                                             | `FeatureFlags`                    | runtime   |
| `src/i18n/`          | Detects and persists the active locale, wires vue-i18n, and syncs the document title                                  | `LocaleSwitcher` (service)        | runtime   |
| `src/module/`        | The feature-module contract and the registry that validates, orders, boots and collects messages from modules         | `ModuleDefinition` (contract)     | type-only |
| `src/notifications/` | Toast and confirm-dialog services - state and lifecycle only; rendering stays app-side                                | `ToastService` / `ConfirmService` | runtime   |
| `src/query/`         | List-query, resource and API-query composables over the foundation `ApiQuery` and `ResourceClient`                    | `ResourceClient` (service)        | runtime   |
| `src/realtime/`      | The EventSource adapter of the foundation realtime port (the WebSocket adapter ships in foundation)                   | `RealtimeConnection`              | no        |
| `src/reporting/`     | Installs the global error handlers that feed the foundation error reporter and breadcrumb trail                       | `ErrorReporter`                   | type-only |
| `src/router/`        | Vue Router binding: router factory, route-meta typing, middleware wiring, chunk-load recovery, navigation progress    | `RouteMiddleware` (contract)      | runtime   |
| `src/session/`       | The opt-in session module: bearer-auth store, route guards, token refresh, redirect handling, and session persistence | `SessionApi`                      | runtime   |
| `src/storage/`       | Browser and strict Web Storage adapters, the IndexedDB session record store and the Web Locks session lock            | `KeyValueStorage`                 | no        |
| `src/support/`       | Clipboard access                                                                                                      | -                                 | no        |
| `src/theme/`         | The colour-scheme boot script, DOM applier and `matchMedia` source for the foundation colour-scheme service           | `ColorSchemeService`              | no        |
| `src/updates/`       | Polls the deployed runtime document for a new release and notifies when one appears                                   | `UpdateMonitor` (no port)         | no        |

## Installation

```bash
npm install @sinemacula/foundation-web vue vue-router vue-i18n pinia
```

`vue`, `vue-router`, `vue-i18n` and `pinia` are peer dependencies. The `exports` map resolves to the compiled `dist/`
and the `prepare` script builds it, so a git dependency (`github:sinemacula/foundation-web-ts#<ref>`) installs the same
output as the registry tarball.

There is no barrel: import each module by its subpath. The `exports` map is the public surface; anything unlisted is
internal.

```ts
import { createFoundationWebApp } from '@sinemacula/foundation-web/app/create-foundation-web-app';
```

## Usage

### Modules

An application is composed of feature modules. A module is a plain object satisfying `ModuleDefinition`
(`src/module/module.ts`); the application owns an explicit, ordered array of them and hands it to
`createFoundationWebApp`. There is no filesystem discovery.

| Field      | Semantics                                                                                  |
|------------|--------------------------------------------------------------------------------------------|
| `name`     | Required. Unique across the registry (duplicates throw); also the translation namespace    |
| `routes`   | Required. Routes contributed to the application router, in registry order                  |
| `locales`  | Optional loader resolving the module's translations for one locale, null when not provided |
| `guards`   | Optional global middleware, run on every navigation before route-level `meta.middleware`   |
| `stores`   | Optional store hooks instantiated eagerly at the stores phase, in registry order           |
| `register` | Optional synchronous hook contributing HTTP machinery before the client is built           |
| `boot`     | Optional post-router, pre-mount hook for runtime effects; may return a teardown            |
| `fallback` | Optional marker: this module owns the application catch-all; the registry orders it last   |

`locales` messages land under the `name` namespace (build a loader from an import map with `createLocaleLoader`).
`guards` run in registry order, and instances may be created at module-definition time provided they defer all store
and service access to `handle()`. A `stores` entry is `(pinia) => { $dispose() }` - a `defineStore` hook fits
directly - instantiated after pinia and storage install and before i18n and the router. `boot` receives the full
runtime context (app, router, pinia, i18n, http, storage, config, platform seams and the realtime connection, or
null). `fallback` may be declared by at most one module, and keeping the catch-all last within that module's own
`routes` array remains the module's responsibility.

The registry validates the list and fixes the effective order: declaration order, with the (at most one) `fallback`
module moved last. A duplicated name throws a `ModuleRegistryError` listing every duplicate; more than one fallback
throws naming each of them. `createFoundationWebApp` builds the registry itself - applications only maintain the array.

The lifecycle then runs in registry order. `register` hooks execute first, after configuration, storage, feature
flags, notifications and observability are installed but before the HTTP client, stores, i18n and router exist, each
receiving a `ModuleHttpRegistrar` whose contributions feed the HTTP client's construction: `addRequestInterceptor`
(appended after preset-level interceptors, in registry order), `addResponseErrorHandler` (run after the preset's
handler, in registry order), and `setUnauthorizedHandler` - a single slot registry-wide, one refresh authority per
application; a second call throws naming both contributing modules. `stores` factories run next, and `boot` hooks
last. Teardown runs the other way: every teardown a `boot` returned disposes in LIFO order (a boot rejection tears
down the already-booted modules and rethrows), followed by each store's `$dispose` in reverse, all folded into the
application handle's `dispose()`.

`collectModuleRoutes` and `collectModuleGuards` (`src/module/module.ts`) flatten a registry's contributions, and the
locale wiring loads module messages in parallel, memoised per locale; the preset threads all of them, so applications
rarely call them directly.

#### Splitting a module's translations

A module's `locales` loader only has to resolve to a `LocaleMessages` (`Record<string, unknown>`) for each locale, so a
large translation tree can be split across files with no kernel change: point the loader at a directory whose
`index.ts` composes the parts, and `module.ts` stays untouched.

```ts
// modules/users/locales/en-us/index.ts
import detail from './detail';
import list from './list';

export default { list, detail };
```

Compose statically. The kernel loads every module's messages for a locale in one pass when that locale activates, so
there is no per-view deferral seam - splitting organises source, it does not lazy-load. Keep message keys camelCase as
elsewhere. Never name a part `module.ts`, `routes.ts` or `route-names.ts`: the module-contract lint matches those
basenames anywhere beneath `modules/<name>/` and would demand the module's canonical exports from your translation
file. Reserve the directory's `index.ts` for the composition entry and give each message group its own descriptively
named file. Keep a single flat `<locale>.ts` per module as the default, and split only the locales that have grown
large.

### Bootstrapping an application

`createFoundationWebApp` (`src/app/create-foundation-web-app.ts`) assembles a complete application from the kernel: it
fetches the runtime environment document, freezes the configuration, installs every service singleton, runs the module
lifecycle and wires the colour scheme, i18n, routing, observability, chunk recovery, realtime and the release monitors.
The phase order is fixed, so the boot's ordering constraints are structural: notifications and observability before the
HTTP client, storage before stores, stores before i18n and the router.

The application's configuration definition must structurally satisfy `FoundationConfig`
(`@sinemacula/foundation/app/foundation-config`), the slice the preset reads: `api.baseUrl`/`api.timeout`,
`app.name`/`app.environment`/`app.version`, `featureFlags.flags` and `locales.default`/`locales.enabled`/
`locales.supported`. Applications define richer trees around it.

#### Options

Top-level: `root` (the component mounted by `start()`), `modules` (the explicit ordered module list) and an optional
`pinia` instance (injectable for tests; defaults to a fresh one). Everything else is grouped:

| Group           | Configures                                                                                                 |
|-----------------|------------------------------------------------------------------------------------------------------------|
| `config`        | `createEnvironment` + `define` + `runtimeUrl` - environment construction and the frozen tree               |
| `http`          | `interceptors`, `onResponseError`, `unexpectedErrorToastKey`, `client` - the HTTP client build             |
| `i18n`          | `sharedLoaders`, `formats`, `localeStorageKey`, `duplicateNamespaceStrategy`                               |
| `colorScheme`   | `defaultPreference` (default `system`), `storageKey` (default `theme`), `themeColors` for `theme-color`    |
| `observability` | `reporter` / `analytics` / `logger` adapter factories over the frozen config                               |
| `featureFlags`  | Provider factory; defaults to the static adapter over `featureFlags.flags`                                 |
| `realtime`      | Opt-in connection factory; installed into the realtime holder, disconnected on dispose                     |
| `notifications` | `toasts` / `confirm` service instances - state only, rendering hosts stay application-side                 |
| `monitors`      | `updates`, `connectivity` and `chunkRecovery` - release monitoring and chunk-load recovery                 |
| `platform`      | `fetchFn`, `storage`, `targetWindow`, `targetDocument`, `clock`, `schedule`, `history`, `localeCandidates` |

Defaults and behaviours worth knowing:

- `config.createEnvironment` is caller-owned - the only place build-time variables may appear. It receives the fetched
  runtime document; pair it with `createWebEnvironment` (`src/config/web-environment.ts`), which chains the runtime
  document ahead of the prefixed build-time variables (default prefix `VITE_`) in development and, in production, throws
  a `ConfigurationError` naming every missing `requiredKeys` entry. `config.runtimeUrl` (default `/runtime-env.json`) is
  one URL for both the runtime-environment fetch and the update monitor's default poll target. A 404 boots over an empty
  document; any other failure, or no document within 5 seconds, rejects the boot with a `RuntimeEnvironmentError` as the
  `FoundationWebBootError` cause.
- `http.unexpectedErrorToastKey` arms the default response-error handler: it skips validation failures and 401s,
  raises the application's toast and captures the error with request context. Without it (and without an
  `onResponseError` override) unexpected failures are captured only. The key is application copy - the kernel ships
  no translation keys. Module register-phase handlers always run after the resolved handler.
- `i18n.localeStorageKey` defaults to `locale`; `duplicateNamespaceStrategy` defaults to `error` - a module name
  shadowing a shared top-level translation key throws at activation, and `module-wins` restores the shadowing merge.
- Without `observability` factories, the `local` environment gets console adapters and every other environment gets
  the null adapters; a factory receives the full frozen config so adapter selection is config-driven.
- `monitors.updates` runs by default when `app.version` is not the `dev` sentinel, but only arms when `toastKey` (an
  application-owned sticky-toast key) or `onUpdate` is provided; enabling it explicitly with neither rejects the boot
  with a `FoundationBootError` as the `FoundationWebBootError` cause. `monitors.connectivity` defaults to on exactly
  when the update monitor runs and pauses its polling while offline. `monitors.chunkRecovery` is on by default: a
  chunk-load or stylesheet-preload failure reloads the tab once per window (default 60s) at the router's URL for the
  target, guarded in that tab's `sessionStorage`; when that storage is unavailable it reports instead of reloading.
- Inline `createColorSchemeBootScript({ storageKey, defaultPreference })` (`./theme/color-scheme-boot`) in the host
  page's `<head>`, with the same values passed to `colorScheme`, so the first paint matches the stored scheme. It
  reads `localStorage`, so a custom `platform.storage` is not visible to it.
- A navigation redirected by middleware more than ten times fails with a `RedirectLoopError`
  (`./router/redirect-loop-error`) through the router's error flow instead of looping.
- The `platform` seams thread to every subsystem and to module hooks (as `ResolvedPlatform`), which is how tests drive
  the full boot: fake fetch, `MemoryStorage`, `createMemoryHistory`, a detached document, a fixed clock, a hand-run
  `schedule` (delayed work, cancelled through the function it returns; defaults to the global timers) and an injected
  pinia.

#### Entry point

The whole composition root is one call. The canonical example is the playground's (`playground/src/boot.ts`, called
from `playground/src/main.ts`), shown here as a single entry file with its imports de-aliased:

```ts
import { createFoundationWebApp } from '@sinemacula/foundation-web/app/create-foundation-web-app';
import { createWebEnvironment } from '@sinemacula/foundation-web/config/web-environment';
import { createSessionModule } from '@sinemacula/foundation-web/session/create-session-module';

import App from './App.vue';
import { defineConfiguration } from './config';
import { REQUIRED_RUNTIME_KEYS } from './config/runtime';
import { sharedLocaleLoaders } from './locales';
import { localeFormats } from './locales/formats';
import { modules } from './modules';

async function start(): Promise<void> {
    const app = await createFoundationWebApp({
        root: App,
        modules: [createSessionModule(), ...modules],
        config: {
            createEnvironment: runtime =>
                createWebEnvironment({
                    runtime,
                    dev: import.meta.env.DEV,
                    buildTimeEnv: import.meta.env,
                    requiredKeys: REQUIRED_RUNTIME_KEYS,
                }),
            define: defineConfiguration,
        },
        http: { unexpectedErrorToastKey: 'common.states.error' },
        i18n: { sharedLoaders: sharedLocaleLoaders, formats: localeFormats },
        monitors: { updates: { toastKey: 'common.updates.available' } },
    });

    await app.start('#app');
}

start().catch(() => {
    // Render a static boot-failure message; nothing has mounted.
});
```

`import.meta.env` appears only here, as input to the caller-supplied `createEnvironment` - no kernel file evaluates
it. The two translation keys are application copy passed as options.

#### start() and dispose()

`createFoundationWebApp` resolves once every phase has run; nothing is mounted yet. When a phase fails, the failure is
reported with `source: 'boot'` once the error reporter is wired, everything installed so far is torn down, and the boot
rejects with a `FoundationWebBootError`: the original error is its `cause`, and `reference` is the short code the report
carries in its context (null when nothing was reported), for the application's fallback page to show. Teardown failures
are reported under the same reference. `observability.reference` replaces the default random `XXXX-XXXX` generator.
`start(selector?)` awaits `router.isReady()` and then mounts (default `#app`), so initialisation completes before any
component renders. A handle starts once: a second `start()` rejects, and so does a `start()` after, or racing,
`dispose()`. The handle also exposes the assembled `app`, `router`, `pinia` and `i18n`, the frozen `config` tree, typed
references to every installed service under `services`, and the started `monitors`, so tests never need ambient access.

`dispose()` idempotently unmounts the root and tears down everything the boot installed, in reverse: the monitors,
chunk recovery, module boot teardowns, realtime disconnect, the page-tracking, global-error-handling and title-sync
uninstalls, the router history, store disposals, pending toasts and finally the colour-scheme listener. Every step runs
even when one throws, and `dispose()` then rethrows the failure. Service holders are left installed;
`resetFoundationWebServices()` clears them between tests and before booting a replacement application.

#### Service accessors

The preset installs every service into a holder exposed by `@sinemacula/foundation-web/app/services`
(`src/app/services.ts`, which re-exports the foundation holders and adds the locale switcher). Components, stores and
module services read them through typed accessors; each throws until its `install*` counterpart has run, which the boot
guarantees happens before mount:

| Accessor                   | Service                                                               |
|----------------------------|-----------------------------------------------------------------------|
| `appConfig<T>()`           | The frozen configuration tree, cast to the application's shape        |
| `appConfigRepository<T>()` | The configuration repository (dot-notation `get`)                     |
| `api()`                    | The HTTP client                                                       |
| `appStorage()`             | The key-value storage adapter                                         |
| `toasts()`                 | The toast service                                                     |
| `confirmDialogs()`         | The confirmation dialog service                                       |
| `reporting()`              | The error reporter                                                    |
| `analytics()`              | The analytics tracker                                                 |
| `logger()`                 | The logger                                                            |
| `featureFlags()`           | The feature-flag adapter                                              |
| `colorScheme()`            | The colour-scheme service                                             |
| `localeSwitcher()`         | The locale switcher                                                   |
| `realtime()`               | The realtime connection (installed only when the application opts in) |

`appConfig<T>()` keeps configuration app-typed through its generic - the playground wraps it once (`config()` in
`playground/src/services/config.ts`) and every other accessor is used as-is. `resetFoundationWebServices()` clears every
holder between tests.

### Session module

`createSessionModule` (`src/session/create-session-module.ts`) returns a plain `ModuleDefinition`: session support is
opt-in and installs itself through the module contract, with no preset special case. At register it installs the
session context and contributes the bearer-token interceptor plus the single unauthorized handler (a
`SessionRefreshCoordinator`, so the reactive 401 path, the proactive refresh timer and realtime reconnects never race).
A 401 for a request sent with a session token the session has since replaced is retried on the current token without
refreshing again, while a current token is held; any other 401 refreshes first.
At the stores phase the store starts hydrating the persisted session; guards, the bearer interceptor, refreshes and
the boot hook all wait for that hydration, so the first navigation never sees a half-loaded session. At boot it wires
the session-loss redirect (login route plus the sanitised current path under the `redirect` query key), cross-tab
mirroring, identity fan-out to the reporting, analytics and feature-flag holders (touching only the channels whose
mapped value changed, and clearing them on sign-out), proactive refresh ahead of expiry (each tab at its own random
point in the earlier half of the `refreshSkewMs` window, so tabs do not refresh together), and the realtime
connection's session binding.

The store returns the foundation outcomes: `login()` resolves a `LoginOutcome` (`authenticated`, `interactionRequired`
with the pending credential, or `superseded`) and `refresh()` a `RefreshOutcome`. A refused or pending refresh clears
the session itself; the module never clears it a second time. A refresh whose session another sign-in replaced by the
time it settles reports `superseded`. `logout()` clears the session locally at once, then signs it out on the server
with its own captured tokens, skipped when a newer sign-in has been persisted meanwhile; a sign-in presents the held
refresh token so the server can supersede that session.

Every option defaults to the reference application's behaviour: `name` (`session`), `storeId` (`auth`), `api` (the
foundation default gateway on the platform clock; required when the application declares its own user type),
`storageKeys`, `routes`, `persistence`, `exchangeLock`, `refreshSkewMs` (60 seconds), `deviceOs` (`WEB`), `generateUuid`
(`crypto.randomUUID()`), the `crossTabSync`/`proactiveRefresh`/`sessionLossRedirect`/`realtimeFollowsSession` toggles
(all true) and `identity` (per-channel mappings, or `false` to disable).

The session persists as one revisioned snapshot, `{ revision, session: { lineage, tokens } }`, in a single IndexedDB
record (database `<key>`, object store `session`, record `snapshot`) through `IndexedDbSessionRecordStore` and the
foundation `RecordSessionPersistence`. Each conditional write is one readwrite transaction that reads, decides and
writes atomically for every tab, and resolves only once committed, so no tab can be handed a lock before it sees
another tab's rotation. Every sign-in starts a new lineage (`crypto.randomUUID()`) that its rotations keep, so another
tab's rotation only updates the tokens, keeping the user, `sessionIdentity()`, the identity fan-out and the realtime
connection, while another tab's sign-in replaces the session. Sign-in, refresh and sign-out exchanges run under a Web
Lock (`<key>:exchange`), so a refresh first adopts a rotation another tab persisted instead of presenting a token that
tab has spent. The module refuses to register when the Web Locks API is unavailable rather than falling back to an
unshared lock; supply `persistence` to store the session elsewhere. A supplied `persistence` serialises only this tab's
exchanges unless `exchangeLock` supplies a lock its sharers hold.

Cross-tab sync never carries the snapshot: after each committed write the module posts an empty message on a
`BroadcastChannel` named `<key>`, and every other tab re-reads the persisted session, as it also does when the page is
restored from the back-forward cache. This works for a supplied `persistence` too, for the writes this module makes;
registering throws when `BroadcastChannel` is unavailable unless `crossTabSync` is false.

Earlier releases kept the snapshot in `localStorage` under `<key>`. Before its first hydration, and under the same
`<key>:exchange` lock those releases exchange under (so a refresh they have in flight lands first), the module adopts a
session found there into the IndexedDB record, but only while that record has never been written, then clears the
`localStorage` snapshot. From then on the record is the only authority: a session a tab still running an earlier
release writes to `localStorage` is cleared without being adopted, so that tab signs out instead of exchanging tokens
the record no longer tracks. A failed retirement is reported and the session still hydrates from the record.

Where the browser blocks site storage (reading `localStorage` or `indexedDB` throws, or IndexedDB is missing), the
default keeps the session in memory instead: sign-in works until the page reloads, no Web Lock is taken, cross-tab
sync is skipped whatever `crossTabSync` says, and one warning goes to the logger. Once IndexedDB is in use, a failure
to open it or to commit a write rejects that operation, which is reported, rather than switching the tab to memory. A
`persistence` you supply is never replaced; its failures surface. A snapshot that cannot be read is reported once and
leaves the session signed out until the next sign-in overwrites it. The storage keys are a public contract:

| Key          | Default            |
|--------------|--------------------|
| `session`    | `auth.session`     |
| `deviceUuid` | `auth.device_uuid` |

The session key names the IndexedDB database, the Web Lock, the channel and the retired `localStorage` snapshot, so an
application wanting a prefix sets it in the key itself.

With `realtimeFollowsSession`, the realtime connection connects once a session is present, reconnects when another
session replaces it (the store's `sessionIdentity()` tells sessions apart even over identical tokens), retries with
backoff a connect skipped while the token could not be refreshed, and disconnects when the session is lost, or at
teardown when it opened the connection. A refresh on any path that is refused, returns to pending authentication or
fails disconnects it and cancels pending retries, leaving the session as the refresh left it; it stays down until the
session is replaced. Proactive refreshes and retries run on the platform `schedule`. Pass `sessionReconnectGuard()`
from `src/session/session-realtime.ts` as the connection's `beforeReconnect` so each reconnect refreshes an expiring
token first and stops for good when the session ends; an attempt the connection abandoned, or whose session another
sign-in replaced meanwhile, skips without disconnecting.

Route identity is one configurable source feeding the guards, the session-loss redirect and the redirect sanitiser's
loop guard: `login` (`{ name: 'auth.login' }`), `loginPath` (`/login` - set together with `login` when renaming),
`home` (`/`) and `forbidden` (`/forbidden` - the application's fallback module owns the page).

What stays application-side: the login route and view, the credential form, all locale copy, and the user field
mapping when the wire shape diverges (`mapUser` on the foundation default gateway). Applications guard routes with
`authenticated()`, `guestOnly()` and `authorize()` from `src/session/middleware.ts`, check permissions with
`can()`/`useCan()` from `src/session/authorization.ts`, and read session state through `useSessionStore()`. When a
signed-in user cannot be loaded, `authorize()` fails the navigation with a `SessionError` rather than reporting the
permission as missing.

## ESLint preset

`@sinemacula/foundation-web/eslint` is a flat-config layer that enforces the feature-module contract, enabled alongside
the shared `@sinemacula/coding-standards` presets. The first two rules below apply to all TypeScript and Vue source
except test code (`*.test.*`, `*.spec.*`, `*.test-d.*`, and anything under `__tests__/`, `__mocks__/` or
`test-support/`); the other four apply to TypeScript under `modules/`. The contract files `module.ts`, `routes.ts` and
`route-names.ts` (or `.tsx`) are matched anywhere beneath `modules/<name>/`, and a nested module tree belongs to its
innermost folder. Paths are read relative to the working directory, so run ESLint from the project root.

### `no-snake-case-keys`

Forbids snake_case object-literal keys, computed string keys included; map wire fields through `wire()` instead.

### `module-import-boundary`

Forbids the `@sinemacula/foundation-web` and `@sinemacula/foundation` barrels in favour of subpaths, and imports of
another module's internals by alias or relative path. A module's public surface is `@/modules/<name>` or its explicit
`index`; code outside any module, such as the registry, may also import a module's `module.ts` definition.

### `module-name-matches-folder`

Requires the `name` of a `ModuleDefinition` declared in `module.ts` to equal its folder, as it is also the module's
translation namespace.

### `module-export-names`

Requires `module.ts`, `routes.ts` and `route-names.ts` to export `<folder>Module`, `<folder>Routes` and
`<FOLDER>_ROUTE_NAMES`, with the folder in camelCase or UPPER_SNAKE_CASE.

### `route-name-namespacing`

Requires every string in a `_ROUTE_NAMES` map, nested groups and `Object.freeze` included, to read `<folder>.<kebab>`.

### `route-name-via-constant`

Requires route names in `routes.ts`, `redirect` locations included, to reference a `_ROUTE_NAMES` constant rather than
an inline string.

## Requirements

- Node.js 22+
- Vue 3.5+, Vue Router 4+, vue-i18n 11+ and Pinia 3+ (peers)
- ESLint 9+, typescript-eslint 8, `@typescript-eslint/utils` 8 and vue-eslint-parser 10+, only for the ESLint preset
  (optional peers)

## Testing

```bash
npm test                      # unit suite
npm run test:coverage         # unit suite with 100% coverage enforced
npm run test:mutation         # Stryker mutation gate (break 90)
npm run typecheck             # type-check
npm run check                 # static analysis and lint via qlty
npm run fmt                   # format via qlty
npm run smells                # duplication / complexity smells via qlty
npm run deadcode              # dead-code detection via knip
npm run check:pkg             # publint + attw on the packed tarball
npm run test:eslint           # ESLint preset rule tests only
npm run test:mutation:eslint  # ESLint preset mutation gate (break 85)
npm run lint:structure        # ESLint preset over src, playground/src and e2e
npm run test:e2e              # Playwright suite against the playground
npm run size                  # size-limit budgets on the playground build
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a list of notable changes.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on branching, commits, code
quality, and pull requests.

## Security

If you discover a security vulnerability, please report it responsibly. See [SECURITY.md](SECURITY.md) for the
disclosure policy and contact details.

## License

Licensed under the [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0).
