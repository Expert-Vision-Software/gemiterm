# GemiTerm Agent Guide (Bun Rewrite)

Context for AI assistants and human contributors working in this repository.
This file is the **persistent project context**; the per-session **goal** is supplied
in the user message and is intentionally not duplicated here.

---

## What this project is

A Bun-native TypeScript rewrite of **gemiterm**, a CLI for Google's Gemini web app.
This rewrite will be released as **v2.0.0** and will replace the Python v1.4.1
implementation currently published from `Expert-Vision-Software/gemiterm`.

- **Upstream repo (reference only):** https://github.com/Expert-Vision-Software/gemiterm
- **Local clone of upstream (Python v1.4.1 source, reference only):**
  `C:\dev\projects\github\webgemini-cli\`
- **This repo (Bun rewrite, the v2.0.0 target):** `C:\dev\projects\github\gemiterm-bun-rewrite\`
- **Active branch:** `gemiterm-bun-rewrite`
- **Status:** functionally complete (432/432 tests pass, 11 CLI commands
  registered, auth flow working). CI/release pipeline is captured in the
  `cross-platform-build-and-ci` OpenSpec change and is **not yet implemented in code** —
  only the OpenSpec artifact is on disk (`openspec/changes/cross-platform-build-and-ci/`).

## Goal & design intent

The goal of **each work session** is supplied in the user message — read it there.

Standing design intent (does not change session to session):

- **Functional parity with the Python v1.4.1 implementation** is the baseline.
- **Explicit deviation:** browser launch and automation go through the
  `playwright-cli` subprocess (`@playwright/cli` on npm), not the
  Python `playwright` SDK. This means some of the cross-platform browser
  detection the Python code carried is no longer ours to do — `playwright-cli`
  handles its own browser install (`playwright-cli install chromium`),
  its own browser selection (`--browser=chromium|chrome|msedge|firefox|webkit`),
  and its own CDP attach (`--cdp=`).
- **Seamless v1.4.1 → v2.0.0 upgrade** is required: the v2.0.0 binary must
  read the existing `%APPDATA%\gemiterm\` (Windows) / `~/.config/gemiterm/`
  (POSIX) config dir unchanged, and the new `install.ps1`/`install.sh` must
  replace the v1.4.1 installer in place. This is captured in the
  `v2-install-migration` OpenSpec change.

## Sensitive area — do not modify lightly

We troubleshooted and fixed a specific issue with **subprocess spawning and
capturing authentication cookies** through `playwright-cli`. The fix landed in
commits `4bc4de8` and `0ec3682`. The following files are the working
implementation and must be treated as a regression-test gate:

- `src/services/playwright-cli-driver.ts` — subprocess runner, argv builder,
  cookie-list output parser. Owns the `BunPlaywrightRunner` and
  `PlaywrightRunner` interface.
- `src/services/cookie-monitor.ts` — login-detection polling loop. Uses the
  sign-out link probe (`e4d1fef`), not a textarea/URL check.
- `src/services/auth-service.ts` — orchestrates `playwright-cli-driver` +
  `cookie-monitor` for the `auth` command flow.
- `src/services/cookie-storage-service.ts` — 7-day freshness window, composes
  `CookieStorage` via DI.

If any change touches these files, the full test suite must pass
(`bun run test` — 432/432 baseline) and the affected service-level tests
(`tests/services/playwright-cli-driver.test.ts`,
`tests/services/cookie-monitor.test.ts`,
`tests/services/auth-service.test.ts`,
`tests/services/cookie-storage-service.test.ts`) must be inspected manually.

## Tooling

- **openspec CLI** — used per the `openspec-*` skills for proposing, applying,
  syncing, and archiving OpenSpec changes. The change artifacts in
  `openspec/changes/` are the source of truth for pending work; the
  committed specs in `openspec/specs/` describe the current state.
- **deepwiki** — for any GitHub link mentioned in context or any third-party
  library reference (e.g. `@playwright/cli`, `bun build`).
- **plannotator** — `submit_plan` is for **action plans** that the user will
  execute. Not for plans that themselves produce further plans.
- **serena** — preferred for code exploration and editing. Use serena
  `find_symbol`, `find_file`, `search_for_pattern`, `read_file`, `replace_*`
  before falling back to `grep`/`glob`/`read`/`edit`.
- **bash** — PowerShell 7+ (`pwsh`) on Windows. Use the `workdir` parameter
  instead of `cd`; do not change directories inside a command.

## How to work

- Default to **delegating to subagents**; behave as a master coordinator.
  Batch work into **sequential** chains (when output feeds the next step)
  and **parallel** batches (when investigations are independent).
- **Run `bun run test` after any non-trivial change** and confirm it stays
  at the 432/432 baseline.
- **Commit frequently** with conventional-commit messages. **Never push.**
- The OpenSpec proposal/design/tasks artifacts in
  `openspec/changes/<change-name>/` are documentation, not implementation.
  They describe what to build; the build is done by a follow-up
  implementation pass that the OpenSpec change's `tasks.md` tracks.
- Read `openspec/MAESTRO_MIGRATION.md` before proposing new work — it maps
  the original Python → Bun migration tasks to current status and to the
  specific OpenSpec change that handles any remaining work.

## Code conventions

- **Path and file operations are mandatory mediation.** No file in `src/`
  outside `src/infrastructure/path-utils.ts`, `src/infrastructure/io.ts`,
  and `src/services/install-browser-service.ts` may import from
  `node:fs`, `node:path`, or `node:os`. The lint script
  `scripts/lint-path-mediation.{sh,ps1}` (also exposed as
  `bun run lint:mediation`) enforces this. If you need a new path or
  file-system helper, add it to the right module first and consume it
  from there — do not bypass the mediation.
- **All new file-system operations go through `io.ts`.** Use
  `writeTextFile` / `readTextFile` / `readJsonFile` / `writeJsonFile` /
  `ensureDir` / `existsFile` / `removeDir` / `renameDir` /
  `isDirectory` / `listSubdirectories` / `safeReadTextFile`. New
  functions should be added only when at least 2 call sites need them.
- **All new path operations go through `path-utils.ts`.** Use
  `resolvePath`, `joinPath`, `dirnamePath`, `getConfigDir`,
  `getProfilesDir`, `getProfilePath`, `getProfileDir`,
  `getDefaultProfileMarkerPath`, `isWSL`, `getProjectRoot`, or
  `getPackageJson`. Do not call `node:path` directly.
- **Errors from `io.ts` throw `IOError`** with a `cause` field for the
  original error. Do not catch and re-throw the raw `node:fs` error.

## Repo hygiene

These items are tracked in the `cross-platform-build-and-ci` change's tasks:

- Orphan file literally named `{` at the repo root.
- Stray bare `{` line in `.gitignore:23`.
- Unused `commander@^15.0.0` in `package.json:29` (the CLI uses hand-rolled
  argv parsing; `commander` is installed but never imported).
- Empty `src/commands/` placeholder containing only `.gitkeep`.
- `bun run build` is broken on Bun 1.3.x (`--compile` no longer accepts
  `--outdir`).

## Queued changes (not yet applied to code)

- `cross-platform-build-and-ci` — CI/CD, build script fix, platform detection
  module, cleanup. 36 tasks. The proposal/design/specs are on disk; the code
  is not.
- `v2-install-migration` — `install.ps1`/`install.sh` for v2.0.0, `INSTALL.md`,
  README upgrade notes. Requires Python v1.4.1 CLI on PATH for parity
  validation. Currently deferred.
- `command-spec-conformance` — bug fixes for profile routing in
  `findProfileForConversation` and the `list --all-profiles` profile column.
  Currently deferred.
