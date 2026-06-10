# GemiTerm Agent Guide

Repo-local context for AI assistants and human contributors. The per-session goal is supplied in the user message; this file is persistent.

---

## What this is

A Bun-native TypeScript CLI for Google's Gemini web app. Released as **v2.0.0** (`package.json:3`). The codebase is fully rewritten — no Python, no transition state, no `commander` dependency. Auth runs through the `@playwright/cli` subprocess (see "Sensitive area" below).

Architecture (verified against the code, not the docs):

```
src/
  cli/                entrypoint + commands + CLI-only utils
    index.ts          argv parsing, mediator wiring, dispatch
    command-registry.ts   explicit registerAllCommands() — 11 commands
    commands/         one file per command (auth, list, fetch, ...)
    utils/            interactive REPL helpers
  core/               mediator (CQRS) + typed handlers + domain types/errors
  services/           business logic: auth flow, cookie mgmt, Gemini client
  infrastructure/     config, io, logger, formatters, validators, cli-table, path-utils
tests/                mirrors src/; plus integration/, smoke/, services/, unit/
openspec/             spec-driven change framework (see "OpenSpec workflow")
```

CLI dispatch flow: `src/cli/index.ts` -> `parseGlobalFlags` (hand-rolled, ~25 lines) -> `CommandRegistry.getHandler` -> handler receives `(args, { verbose, mediator, profileAuthManager })`. Handlers dispatch typed Command/Query messages through the mediator to handlers in `core/command-handlers.ts` / `core/query-handlers.ts`.

The one currently-open OpenSpec change is `commander-cli-parser` (proposes replacing the hand-rolled argv parser with `commander@^15.0.0`).

---

## Build, test, lint — exact commands

```bash
bun install                # install deps (bun.lock is committed)
bun run dev                # = bun run src/cli/index.ts; runs the CLI in dev
bun test                   # full suite — baseline: 544 pass, 0 fail
bun run test:unit          # tests/unit only
bun run test:integration   # tests/integration only
bun run test:parity        # tests/parity (requires v1.4.1 Python CLI on PATH; not run in CI)
bun run test:smoke         # tests/smoke only
bun run typecheck          # tsc --noEmit; clean at HEAD
bun run build              # scripts/build.ts -> dist/gemiterm(.exe)
bun run build:linux        # cross-compile to bun-linux-x64
bun run build:windows      # cross-compile to bun-windows-x64
bun run build:release      # minified host-target build
bun run lint:mediation     # bash version — use this on Windows
```

> **The PowerShell version of the mediation lint is broken.** `bun run lint:mediation:ps` (and `pwsh -File scripts/lint-path-mediation.ps1`) hardcodes `gemiterm-bun-rewrite/` in its path-normalization step (`scripts/lint-path-mediation.ps1:30`). It will report false positives on every file in `src/infrastructure/` and `src/services/install-browser-service.ts`. **Use `bash scripts/lint-path-mediation.sh` (or `bun run lint:mediation`) on Windows** — that one is correct. CI runs the bash form in `.github/workflows/test.yml:23-29`.

Test count and the v2.0.0 release date (2026-06-08) are in `CHANGELOG.md`. Update the baseline number in any open change's `tasks.md` if the count moves.

---

## Sensitive area — do not modify lightly

Auth is the only area with non-trivial history. Cookies are obtained by spawning `playwright-cli` (`@playwright/cli`) and polling with a JS probe for the Google sign-out link. The four files below are the regression-test gate; if you change any of them, re-read the affected service-level test before committing:

- `src/services/playwright-cli-driver.ts` — `BunPlaywrightRunner`, argv builder, cookie-list output parser. Auto-detects between the `playwright-cli` binary and `bunx @playwright/cli`.
- `src/services/cookie-monitor.ts` — polling loop, 2 s interval, 5 min default timeout. Login is detected by probing `a[href^="https://accounts.google.com/SignOutOptions"]` (not textarea/URL).
- `src/services/auth-service.ts` — orchestrates the above for the `auth` command flow. The "Press Enter to launch browser..." prompt is one-shot, not blocking on Enter — that's intentional.
- `src/services/cookie-storage-service.ts` — 7-day freshness window; composes `CookieStorage` via DI.

Service-level test files: `tests/services/{playwright-cli-driver,cookie-monitor,auth-service,cookie-storage-service}.test.ts`.

The full upstream API for the `playwright-cli` subprocess is documented in `docs/PLAYWRIGHT_CLI_API.md` (verified against `@playwright/cli`). Reach for `deepwiki` or the GitHub upstream when the docs are unclear.

---

## Code conventions

**Path and file operations are mandatory mediation.** No file in `src/` outside the three exemptions may import from `node:fs`, `node:path`, or `node:os`. The lint script `scripts/lint-path-mediation.sh` (and the CI step in `.github/workflows/test.yml:23-29`) enforces this. The three exempt files are:

- `src/infrastructure/path-utils.ts` — canonical home for path values
- `src/infrastructure/io.ts` — canonical home for file-system side effects
- `src/services/install-browser-service.ts` — WSL `9p`/`drvfs` mount parser only

If you need a new path or file-system helper, add it to the appropriate module and consume it from there. Do not bypass the mediation. To add a new exemption, update the file list in **both** `scripts/lint-path-mediation.sh` and `.github/workflows/test.yml` and the `if` block in `scripts/lint-path-mediation.ps1`, with a comment explaining why.

The `io.ts` surface to use: `writeTextFile`, `readTextFile`, `readJsonFile`, `writeJsonFile`, `ensureDir`, `existsFile`, `removeDir`, `renameDir`, `isDirectory`, `listSubdirectories`, `safeReadTextFile`. Add new helpers only when at least 2 call sites need them. Errors from `io.ts` throw `IOError` with a `cause` field — do not catch and re-throw the raw `node:fs` error.

The `path-utils.ts` surface: `resolvePath`, `joinPath`, `dirnamePath`, `getConfigDir`, `getProfilesDir`, `getProfilePath`, `getProfileDir`, `getDefaultProfileMarkerPath`, `getTempFilePath`, `isWSL`, `getProjectRoot`, `getPackageJson`. Config dir resolution: `GEMITERM_CONFIG_DIR` env -> `%APPDATA%\gemiterm` (Windows) -> `~/gemiterm` (POSIX). v1.4.1 -> v2.0.0 upgrade preserves this dir unchanged.

General style: no comments unless explicitly asked. Conventional-commits, commit frequently, never push. Default to delegating to subagents (sequential when output feeds the next step, parallel otherwise). Run `bun test` after any non-trivial change and confirm the baseline is intact.

---

## OpenSpec workflow

`openspec/` is the source of truth for pending work (changes) and the committed specs for the current state. Use the `openspec-*` skills:

- `openspec-propose` — generate proposal/design/tasks for a new change
- `openspec-apply-change` — implement tasks from an existing change
- `openspec-sync-specs` — sync delta specs from a change to main specs
- `openspec-archive-change` — archive a completed change
- `openspec-explore` — think through an idea before proposing

Layout:

- `openspec/specs/<capability>/spec.md` — committed main specs, the current state. Don't edit directly; deltas flow from changes.
- `openspec/changes/<name>/{proposal,design,tasks}.md` — work in progress. Artifacts are documentation of what to build; the build is done by a follow-up implementation pass that the change's `tasks.md` tracks.
- `openspec/changes/archive/` — completed changes, kept for history.
- `openspec/MAESTRO_MIGRATION.md` — historical task-by-task migration status from the Python -> Bun rewrite. Useful background, not authoritative for current state.
- `openspec/config.yaml` — project config for the OpenSpec CLI.

Before proposing new work, list `openspec/changes/` (excluding `archive/`) to see what's already in flight.

---

## Tooling

- **serena** — preferred for code exploration and editing (`find_symbol`, `find_file`, `search_for_pattern`, `read_file`, `replace_*`). Fall back to `grep` / `glob` / `read` / `edit`.
- **deepwiki** — for GitHub links and third-party library references (e.g. `@playwright/cli`, `bun build`).
- **plannotator** — `submit_plan` is for action plans the user will execute, not for plans that themselves produce more plans.
- **bash** — PowerShell 7+ (`pwsh`) on Windows. Use the `workdir` parameter instead of `cd`; don't change directories inside a command.
- **Delegation** — default to orchestrating subagents; batch parallel investigations; chain sequential work when output feeds the next step.
