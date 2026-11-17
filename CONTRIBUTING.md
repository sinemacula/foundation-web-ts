# Contributing

Contributions are welcome via GitHub pull requests.

## Requirements

- Node.js 22+ (`.nvmrc` pins the version used for development)
- npm

## Getting Started

```bash
git clone git@github.com:sinemacula/web-core-ts.git
cd web-core-ts
npm install
```

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
lives in `.qlty/` and is enforced by qlty Cloud on every pull request.

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

- The kernel (root `src/`) stays product-agnostic: no Vue component code, ports and adapters at the edges. Product and
  application functionality belongs in `playground/`.
- No barrel files; consumers import the kernel by subpath (e.g. `@sinemacula/web-core/app/create-web-core-app`).
- Behaviour lives in plain TypeScript; Vue single-file components stay thin (template plus wiring).
- Imports between playground modules go through a module's public surface (`@/modules/<name>`, its `index.ts`), never
  into its internals.
- Wire-format keys (snake_case) never appear as object-literal keys; use the `wire()` entry-tuple idiom.
- Styling uses the `--sm-*` design tokens; components never hard-code visual values.
- New code ships with colocated tests; the 100% coverage thresholds and the mutation-testing gate
  (`npm run test:mutation`) are the enforced floors.

## Pull Requests

- Keep changes minimal and scoped to a single concern
- Do not change static analysis or formatting configuration without prior discussion
- Include tests for new or changed behaviour
- Ensure `npm run check` and `npm run test:coverage` pass

## Security

Report security vulnerabilities directly to Sine Macula rather than opening a public issue. See
[SECURITY.md](SECURITY.md) for details.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
