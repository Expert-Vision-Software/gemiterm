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
bun test                   # full suite — baseline: 657 pass, 0 fail
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

> **The PowerShell version of the mediation lint is broken.** `bun run lint:mediation:ps` (and `pwsh -File scripts/lint-path-mediation.ps1`) hardcodes `gemiterm-bun-rewrite/` in its path-normalization step (`scripts/lint-path-mediation.ps1:30`). It will report false positives on every file in `src/infrastructure/`. **Use `bash scripts/lint-path-mediation.sh` (or `bun run lint:mediation`) on Windows** — that one is correct. CI runs the bash form in `.github/workflows/test.yml:23-29`.

Test count and the v2.0.0 release date (2026-06-08) are in `CHANGELOG.md`. Update the baseline number in any open change's `tasks.md` if the count moves.

---

## Sensitive area — do not modify lightly

Auth is the only area with non-trivial history. The auth surface is the `src/auth/` module, composed around a single `CookieSession` facade (`src/auth/cookie-session.ts`) wired in `src/cli/index.ts`. The architecture (2026-08 "fix-1" cutover, evidence in `docs/cookie-ablation-findings.md`):

- `src/auth/cookie-session.ts` — the only auth surface consumed by the CLI: `ensureSession` (arm from disk, spawn detached refresh when jar mtime > 30 min), `captureLogin` (headed capture; the gate is PSID+PSIDTS *presence*, the payload is the **complete** domain-filtered jar — gate is not payload), `probe`, `refresh`, `activeProfiles`, `findProfileForConversation`. All collaborators injectable via `CookieSessionDeps`; no file outside `src/auth/` may import the collaborators directly — the CLI wires everything through `createCookieSession` (also in this file), and the detached spawn lives in `refresh-runner.ts:spawnDetachedRefreshRunner` (resolves the runner path from its own module dir).
- `src/auth/cookie-store.ts` — snapshot/delta CAS saves (stale-overwrite-fresh prevention) + cross-process `storage_state.json.lock` (exclusive-create, CAS fail-open 10 s, full-jar fail-closed 90 s via `LockUnavailableError`, 120 s stale-lock steal). Pure Bun `node:fs` semantics via `infrastructure/io.ts` — no shell commands, no `flock`.
- `src/auth/browser-refresher.ts` — the only PSIDTS rotation engine: headless persistent-profile page load, poll `cookie-list`, `state-save`, persist full jar. `src/auth/refresh-runner.ts` is the standalone detached entry point.
- `src/auth/cookie-validation.ts` — two-tier validation (tier-1 raise: PSIDTS RFC-6265-routable to `gemini.google.com` + PSID present; tier-2 warn-once: companions absent).
- `src/auth/session-classifier.ts` — read-only `live | phantom | dead` oracle (init-GET tokens + `listChats({limit:1})`). Never uses SDK `models()` (static table).
- `src/services/playwright-cli-driver.ts` — `BunPlaywrightRunner`, argv builders (`openHeaded` / `openHeadless`), `stateSave`, cookie-list output parser. Auto-detects between the `playwright-cli` binary and `bunx @playwright/cli`.

**Hard rule (the H6 lesson): no cookie-name filtering anywhere in capture or persistence.** Jars are filtered by domain only (`.google.com`, `.youtube.com`, `accounts.google.com` — `src/auth/auth-constants.ts:filterToGeminiDomains`). Enforced by `tests/auth/full-jar-contract.test.ts` (greppable pin).

Deleted in the fix-1 cutover (do not resurrect): `src/services/{auth-service,cookie-monitor,cookie-storage-service,profile-auth-manager}.ts` and their tests. `GeminiClientService` keeps its 2-cookie SDK construction (fed from `ensureSession` via a `ProfileCookieLoader`); it no longer persists cookies itself — rotation belongs to the refresher.

Service-level test files: `tests/services/playwright-cli-driver.test.ts`, `tests/auth/*.test.ts`. Re-read the affected test before committing any change to these.

The full upstream API for the `playwright-cli` subprocess is documented in `docs/PLAYWRIGHT_CLI_API.md` (verified against `@playwright/cli`). Reach for `deepwiki` or the GitHub upstream when the docs are unclear.

The prompt layer is the second sensitive area. `src/cli/utils/prompts.ts` is the single facade that imports from `@inquirer/prompts` and `@inquirer/core`; it is the only module in `src/` allowed to do so. The TTY gate (`requireTty`), the shared `chalk`-based theme, the module-level `AbortController` (via `getAbortSignal` / `abortActivePrompts` / `resetAbortController`), and the cancellation-to-`CancellationError` mapping all live here. All interactive call sites — including the chat REPL, the auth/profile/delete commands, the chat-list browser, and any future prompts — must route through this facade.

Files in the prompt layer:
- `src/cli/utils/prompts.ts` — facade: `text`, `confirm`, `select`, `browser` (the custom chat-list browser), plus `NonInteractiveError` and `CancellationError`
- `src/cli/utils/interactive-prompt.ts` — chat REPL; uses facade's `text` and `CancellationError` via the `InteractiveLoopDeps` injection point for testability
- `src/cli/commands/auth-command.ts` — `promptInput` shim delegates to facade
- `src/cli/commands/delete-command.ts` — `promptConfirmation` shim delegates to facade
- `src/cli/commands/profile-command.ts` — `promptInput` shim delegates to facade
- `src/cli/commands/list-command.ts` — `--interactive/-i` flag drives `runInteractiveBrowser` (uses `browser` + `select`)

Test files for the prompt layer: `tests/cli/utils/{prompts,interactive-prompt,chat-list-browser}.test.ts`, plus the `--interactive` block in `tests/cli/list-command.test.ts`.

The `gemiterm list -i` (or `--interactive`) flag is the **only** entry point to the chat-list TUI; the non-interactive forms (`gemiterm list`, `gemiterm list --format json`, `gemiterm list --search foo`, `gemiterm list --out out.txt`) are byte-equivalent to the pre-change baseline. Any change to the non-interactive output paths is a regression and must be caught by `tests/integration/commands/list.test.ts`.

---

## Code conventions

**Path and file operations are mandatory mediation.** No file in `src/` outside the two exemptions may import from `node:fs`, `node:path`, or `node:os`. The lint script `scripts/lint-path-mediation.sh` (and the CI step in `.github/workflows/test.yml:23-29`) enforces this. The two exempt files are:

- `src/infrastructure/path-utils.ts` — canonical home for path values
- `src/infrastructure/io.ts` — canonical home for file-system side effects

If you need a new path or file-system helper, add it to the appropriate module and consume it from there. Do not bypass the mediation. To add a new exemption, update the file list in **both** `scripts/lint-path-mediation.sh` and `.github/workflows/test.yml` and the `if` block in `scripts/lint-path-mediation.ps1`, with a comment explaining why.

The `io.ts` surface to use: `writeTextFile`, `readTextFile`, `readJsonFile`, `writeJsonFile`, `ensureDir`, `existsFile`, `removeDir`, `removeFile`, `renameDir`, `isDirectory`, `listSubdirectories`, `safeReadTextFile`, `writeFileExclusive`, `writeTextFileAtomic`, `getFileMtime`. Add new helpers only when at least 2 call sites need them. Errors from `io.ts` throw `IOError` with a `cause` field — do not catch and re-throw the raw `node:fs` error.

The `path-utils.ts` surface: `resolvePath`, `joinPath`, `dirnamePath`, `getConfigDir`, `getProfilesDir`, `getProfilePath`, `getProfileLockPath`, `getProfileDir`, `getDefaultProfileMarkerPath`, `getTempFilePath`, `isWSL`, `getProjectRoot`, `getPackageJson`. Config dir resolution: `GEMITERM_CONFIG_DIR` env -> `%APPDATA%\gemiterm` (Windows) -> `~/gemiterm` (POSIX). v1.4.1 -> v2.0.0 upgrade preserves this dir unchanged.

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
