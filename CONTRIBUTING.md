# Contributing

Contributions are welcome via GitHub pull requests. This guide covers the expectations for working on this package.

## Requirements

- Node.js 22+ (`.nvmrc` pins the version used for development)
- npm

## Getting Started

```bash
git clone git@github.com:sinemacula/web-core-ts.git
cd web-core-ts
nvm use
npm install
cp playground/.env.example playground/.env   # local development variables (VITE_*)
npm run dev                                  # playground dev server
```

`npm install` builds `dist/` through the `prepare` script. The `exports` map resolves to `dist/`, so run
`npm run build:dist` after changing `src/` when another project links this checkout. `npm run build` and
`npm run preview` build and serve the playground.

## Repository Layout

```text
src/           The kernel package source - one directory per area, tests colocated
eslint/        The module-contract ESLint preset, published as @sinemacula/web-core/eslint
playground/    Reference application + dev harness (@sinemacula/web-core-playground)
e2e/           Playwright suite driving the playground application
scripts/       Package build and mutation-scope scripts
```

The playground consumes the kernel as `"@sinemacula/web-core": "file:.."`. Inside this repository the TypeScript, Vite
and Vitest configs map only the exported subpaths to `src/`, so the playground and tests run with no build step and
the playground's imports are exactly what an external consumer writes. For the application-side details - boot
sequence, runtime environment mechanics, adding a feature module - see [playground/README.md](playground/README.md).

## Development Workflow

### Branching

Branch from `master` using the appropriate prefix:

| Prefix      | Purpose                          |
|-------------|----------------------------------|
| `feat/`     | New functionality                |
| `fix/`      | Bug fixes                        |
| `refactor/` | Refactoring without new features |
| `docs/`     | Documentation                    |
| `chore/`    | Tooling, CI, dependencies        |

### Commits

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Prefix your commit messages accordingly:

```text
feat: add a proactive session-refresh timer
fix: await the user load before the authorization guard decides
test: cover the locale switcher end-to-end
chore: update qlty configuration
```

### Code Quality

All code must pass static analysis before submission:

```bash
npm run check            # Lint, static analysis and security scans via qlty (Biome, ESLint, ...)
npm run fmt              # Format the codebase via qlty
npm run smells           # Duplication and complexity analysis via qlty
npm run lint:structure   # The module-contract ESLint preset over src, playground/src and e2e
npm run deadcode         # Dead-code detection with Knip (runs outside qlty)
```

Run linting and formatting through qlty rather than invoking the underlying tools directly; the shared configuration
lives in `.qlty/` and is enforced by qlty Cloud on every pull request. The `.qlty/hooks/` hooks format on pre-commit
and check on pre-push.

### Testing

Run the full suite before submitting:

```bash
npm run typecheck        # Type-check with vue-tsc
npm run test:coverage    # Unit tests, with 100% coverage enforced
npm run test:e2e         # End-to-end tests with Playwright
npm run build            # Playground production build
npm run build:dist       # Compile the kernel package to dist/
```

Single test file or test:

```bash
npx vitest run src/session/session-store.test.ts
npx vitest run -t "adopts the persisted session on hydrate"
```

### Standards

- The kernel (root `src/`) stays product-agnostic: no Vue component code, so it stays usable by any Sine Macula
  frontend. Product and application functionality belongs in `playground/`.
- Every behavioural dependency is a port (interface), with adapters at the edges substituted in tests.
- No barrel files; consumers import the kernel by subpath (e.g. `@sinemacula/web-core/app/create-web-core-app`).
- Behaviour lives in plain TypeScript; Vue single-file components stay thin (template plus wiring).
- Imports between playground modules go through a module's public surface (`@/modules/<name>`, its `index.ts`), never
  into its internals.
- Wire-format keys (snake_case) never appear as object-literal keys; use the `wire()` entry-tuple idiom.
- Styling uses the `--sm-*` design tokens; components never hard-code visual values.
- New code ships with colocated tests; the 100% coverage thresholds and the mutation-testing gate
  (`npm run test:mutation`) are the enforced floors.

### Design Decisions

- **Service access is application-singleton, not provide/inject.** The preset installs services into holders exposed
  as typed accessors (`api()`, `toasts()`, ... in `src/app/services.ts`). Accessors keep services usable outside
  component context (stores, middleware, plain modules) and make test substitution explicit
  (`resetWebCoreServices()`). Holders are process-global: one application per page; SSR and multi-app scoping are out
  of scope.
- **Time is a function seam, not a Clock port.** The preset threads `platform.clock` and `platform.schedule`, and each
  time-dependent unit accepts a clock or timer override where tests need determinism.
- **No success-side response interceptors.** The error side has a seam (`onResponseError`); response header access
  and global response transforms wait for a concrete consumer.

## Pull Requests

- Keep changes minimal and scoped to a single concern
- Do not change static analysis or formatting configuration without prior discussion
- Include tests for new or changed behaviour
- Ensure `npm run check` and `npm run test:coverage` pass

## Releases

release-please cuts releases from the Conventional Commit history, and CI publishes them to npm through OIDC trusted
publishing. The `prepare` script builds `dist/` before the tarball is packed.

Below 1.0.0 every release is a new minor version, breaking or not, so a `^0.x` range never moves to a release
unannounced. Graduating to 1.0.0 is an explicit decision that also restores the default versioning strategy.

## Security

Report security vulnerabilities directly to Sine Macula rather than opening a public issue. See
[SECURITY.md](SECURITY.md) for details.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
