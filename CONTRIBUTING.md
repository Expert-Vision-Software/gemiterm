# Contributing to GemiTerm

Thanks for your interest in GemiTerm! This document is for contributors and maintainers. If you just want to **use** the tool, see the [README](README.md) — it covers installation, commands, configuration, and the cross-agent skills bundle.

This guide covers:

- [Architecture](#architecture) — how the codebase is organized
- [Development](#development) — day-to-day dev workflow
- [Building from source](#building-from-source) — produce a release binary
- [Contributing](#contributing) — how to file issues and submit PRs

## Architecture

```
src/
  cli/             # entrypoint, command registry, per-command files, REPL helpers
  core/            # Mediator (CQRS), typed Command/Query messages, handlers, domain types
  services/        # business logic: auth, cookie management, Gemini client, skills installer
  infrastructure/  # config, I/O, logging, formatters, validators, path utilities
tests/
  cli/             # CLI command tests
  core/            # query-handler tests
  services/        # service-layer tests
  infrastructure/  # infrastructure tests
  fixtures/        # shared test fixtures
```

The core uses a **Mediator (CQRS)** pattern: CLI handlers send typed `Command` and `Query` messages to a central mediator, which routes them to registered handlers. This decouples the CLI from the business logic, keeps each command testable in isolation, and makes new commands cheap to add.

Authentication is driven by a [`@playwright/cli`](https://www.npmjs.com/package/@playwright/cli) subprocess. A JS probe polls the page for Google's sign-out link, and cookies are persisted locally for 7 days.

## Development

```bash
bun install
bun run dev              # run the CLI in dev mode
bun test                 # full test suite
bun run test:unit        # unit tests only
bun run test:integration # integration tests only
bun run typecheck        # tsc --noEmit
bun run lint:mediation   # path-mediation lint (enforces the I/O boundary)
bun run check:auth-gate  # auth-regression gate (warns if auth paths changed without auth tests)
bun run canary:auth      # auth mutation canary (verifies regression tests catch bugs)
```

For Chromium installation on different platforms, use the platform-specific wrappers:

```bash
bash scripts/install-browser.sh   # Linux / macOS
pwsh scripts/install-browser.ps1  # Windows
```

> **Path mediation is mandatory.** No file in `src/` outside the two exemptions may import from `node:fs`, `node:path`, or `node:os`. The `lint:mediation` script and CI enforce this. If you need a new file-system or path helper, add it to `src/infrastructure/io.ts` or `src/infrastructure/path-utils.ts` and consume it from there. The two currently-exempt files are `src/infrastructure/path-utils.ts` and `src/infrastructure/io.ts`.

> **Auth regression protection is enforced.** Changes touching auth-sensitive paths (`src/auth/**`, playwright driver, cookie plumbing, `docs/auth-cookie-lifecycle.md`, and paths matched by content regex) must also update the `tests/auth-regression/` suite in the same change. The `check:auth-gate` command enforces this in CI. Use `SKIP_AUTH_REGRESSION_GATE=1` with a stated reason to opt out (audited). The auth mutation canary (`canary:auth`) runs nightly in CI to verify the regression tests would catch historical bug patterns.

## Building from source

GemiTerm requires **[Bun](https://bun.sh) ≥ 1.3.13** to build.

```bash
bun run build            # native binary for the current OS (dist/gemiterm or dist/gemiterm.exe)
bun run build:linux      # cross-compile to bun-linux-x64
bun run build:windows    # cross-compile to bun-windows-x64
bun run build:release    # minified host-target build
```

Output paths:

- **Linux / macOS:** `dist/gemiterm`
- **Windows:** `dist/gemiterm.exe`

### Release artifacts

Each GitHub release ships:

- `GemiTerm` — Linux x64 binary
- `GemiTerm.exe` — Windows x64 binary
- `install.sh` — POSIX installer script
- `install.ps1` — Windows PowerShell installer script

## Contributing

Issues and PRs are welcome. Before opening a pull request:

1. **Read [`AGENTS.md`](AGENTS.md).** It documents the path-mediation rules, the sensitive auth files, the OpenSpec workflow, and the test commands you should run before committing.
2. **Open or comment on an issue first** for non-trivial changes so we can align on approach.
3. **Run the full gate locally** — `bun test`, `bun run typecheck`, and `bun run lint:mediation` must all pass. On Windows use `bash scripts/lint-path-mediation.sh` (the PowerShell version is currently broken — see AGENTS.md).
4. **Check auth-regression status** — if your change touches auth-sensitive paths, run `bun run check:auth-gate` to ensure you've also updated `tests/auth-regression/`. The auth mutation canary (`bun run canary:auth`) verifies the regression tests would catch historical bug patterns.
5. **Use Conventional Commits** for commit messages (`feat:`, `fix:`, `chore:`, `docs:`, …).
6. **Keep PRs focused.** One logical change per PR makes review and bisect much easier.

The sensitive auth flow lives in several files; if your change touches any of them, re-read the matching service-level test before committing and run the auth-regression gate:

- `src/services/playwright-cli-driver.ts`
- `src/services/cookie-monitor.ts`
- `src/services/auth-service.ts`
- `src/services/cookie-storage-service.ts`
- `docs/auth-cookie-lifecycle.md`

The auth-regression suite at `tests/auth-regression/` pins invariants violated by historical phantom-auth bug classes. Any change modifying auth behavior must also update the changelog section of `docs/auth-cookie-lifecycle.md`. Use `bun run check:auth-gate` to verify compliance locally; the CI gate runs automatically and can be opted out with `SKIP_AUTH_REGRESSION_GATE=1` (requires a stated reason, audited).

For planned work, browse the active changes in [`openspec/changes/`](openspec/changes/) — deltas flow from there into the main specs under [`openspec/specs/`](openspec/specs/).

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT license](LICENSE.md).
