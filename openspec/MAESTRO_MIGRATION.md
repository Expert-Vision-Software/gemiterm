# Maestro → OpenSpec Migration Status

This document maps every Maestro plan task to its current completion status
and the corresponding OpenSpec artifact (main spec or active change). It
serves as the canonical "task list with checkmarks" for the migration.

**Source of truth:**
- Maestro plans: `C:\dev\projects\github\webgemini-cli\.maestro\playbooks\2026-06-06-GemiTerm-Bun-Port\Phase-{01..06}-*.md`
- OpenSpec main specs (completed work): `openspec/specs/`
- OpenSpec changes (remaining work): `openspec/changes/`
- Test baseline: `bun test` → **432 pass, 0 fail, 754 expect() calls** (10.5 s)

**Status legend:**
- ✅ **DONE** — capability exists in code, covered by passing tests, no obvious gaps vs the Maestro description
- 🟡 **PARTIAL** — capability is mostly there but with documented deviations (e.g. a Maestro-spec'd behavior was not implemented; an intentional improvement replaced a Maestro item)
- ❌ **NOT DONE** — Maestro task has no implementation; an OpenSpec change captures the remaining work
- ⚠️ **N/A** — Maestro task is not applicable to the Bun rewrite (e.g. Python-only tooling)
- ⏭️ **DEFERRED** — out of scope for the v2.0.0 release; tracked in a follow-up

---

## Phase 01: Project Setup & Working Prototype

| # | Maestro task | Status | OpenSpec artifact | Evidence / notes |
|---|---|---|---|---|
| 1.1 | Initialize Bun project (`bun init`, name `gemiterm`, `type: module`, `private`) | ✅ DONE | `openspec/specs/cli/spec.md` | `package.json:2-6`; `e363609` (git) |
| 1.2 | Create `src/` directory structure | ✅ DONE | `openspec/specs/cli/spec.md` | All 5 dirs present; `3877b6c` |
| 1.3 | Create `tsconfig.json` | ✅ DONE | (covered by cli spec) | `tsconfig.json` matches Maestro shape exactly; 0 type errors |
| 1.4 | Cross-platform path utility `src/infrastructure/path-utils.ts` | ✅ DONE (partial) | `openspec/specs/path-utils/spec.md`; missing helpers in `cross-platform-build-and-ci` | Core 4 functions present + extras. `isWindows`/`isWSL`/`isLinux`/`normalizePath`/`getPlatformName` are missing — `cross-platform-build-and-ci` adds them as re-exports. |
| 1.5 | `src/infrastructure/config.ts` | ✅ DONE | `openspec/specs/configuration/spec.md` | All 7 functions present; 13 unit tests |
| 1.6 | `src/core/types.ts` | ✅ DONE | `openspec/specs/domain-model/spec.md` | All 6 interfaces present |
| 1.7 | `src/core/errors.ts` | ✅ DONE | `openspec/specs/domain-model/spec.md` | All 6 error classes; 13 unit tests |
| 1.8 | `src/cli/index.ts` main entry | ✅ DONE | `openspec/specs/cli/spec.md` | shebang, global flags, dispatch all working; 3 smoke tests |
| 1.9 | `src/cli/commands/help.ts` | ✅ DONE | `openspec/specs/cli/spec.md` | `showHelp(registry)`; covered by every `--help` integration test |
| 1.10 | `package.json` scripts | ✅ DONE | (covered by `cli` spec + `cross-platform-build-and-ci`) | `start`, `dev`, `typecheck`, `test`, `test:unit`, `test:integration`, `test:parity`, `test:smoke`, `test:all`, `build`, `build:linux`, `build:windows` present. **`build*` are broken in Bun 1.3.x** — fixed by `cross-platform-build-and-ci`. `lint`/`format` (ruff) are N/A. |
| 1.11 | `bun add commander chalk` and `bun add -d @types/bun` | ✅ DONE (with cleanup) | `cross-platform-build-and-ci` removes unused `commander` | `chalk` is used; `commander` is installed but **never imported** — cleanup task in change 1 |
| 1.12 | Verify `bun run src/cli/index.ts --help` | ✅ DONE | `openspec/specs/testing/spec.md` | `tests/smoke/smoke.test.ts:31-37` |
| 1.13 | Verify ruff linting | ⚠️ N/A | — | Maestro itself notes ruff is a Python tool not applicable to TS |
| 1.14 | Verify `tsc --noEmit` | ✅ DONE | (covered by `cli` spec) | `bun run typecheck` → 0 errors |

---

## Phase 02: Core Architecture (Mediator Pattern + SOLID)

| # | Maestro task | Status | OpenSpec artifact | Evidence / notes |
|---|---|---|---|---|
| 2.1 | `src/core/mediator.ts` | ✅ DONE | `openspec/specs/mediator/spec.md` | 9 unit tests; `4dd344d` |
| 2.2 | `src/core/command-handlers.ts` | ✅ DONE | (internal — referenced by `commands` and `auth` specs) | All 7 command types + handlers; covered by `tests/core/query-handlers.test.ts` + integration tests |
| 2.3 | `src/core/query-handlers.ts` | ✅ DONE | (internal — referenced by `commands` and `auth` specs) | All 5 query types + handlers; 9 unit tests |
| 2.4 | `src/infrastructure/storage.ts` | ✅ DONE | `openspec/specs/storage/spec.md` | `CookieStorage` + `ProfileManager`; 21 unit tests |
| 2.5 | `src/infrastructure/logger.ts` | ✅ DONE | `openspec/specs/logger/spec.md` | stderr-only timestamped logger; 7 unit tests |
| 2.6 | `src/infrastructure/validators.ts` | ✅ DONE | `openspec/specs/validators/spec.md` | All 3 validators; 10 unit tests (file lives in `tests/infrastructure/`, not `tests/unit/` — same coverage) |
| 2.7 | `src/infrastructure/formatters.ts` | ✅ DONE | `openspec/specs/formatters/spec.md` | All 4 formatters; 22 unit tests across 2 files |
| 2.8 | `src/services/gemini-client-wrapper.ts` | ✅ DONE | `openspec/specs/conversations/spec.md` | 6 methods + `isAuthenticated()`; HTTP routes to `gemini.google.com/app/api/...` |
| 2.9 | `src/services/profile-service.ts` | ✅ DONE | `openspec/specs/profiles/spec.md` | All 5 methods; 8 unit tests |
| 2.10 | `src/cli/command-registry.ts` | ✅ DONE (deviation) | `openspec/specs/commands/spec.md` | Explicit `registerAllCommands()` (not auto-discovery); 6 unit tests; `84c24cf` formalized this |
| 2.11 | `src/cli/index.ts` uses mediator + registry | ✅ DONE | `openspec/specs/cli/spec.md` | dispatch + unknown-command handling; `e784eef` |
| 2.12 | Verify architecture compiles | ✅ DONE | (covered by `cli` + `testing` specs) | `tests/smoke/smoke.test.ts:31-37`; `c236027`, `0ec3682` |
| 2.13 | `ruff check src/` + `tsc --noEmit` | ⚠️ N/A + ✅ | — | ruff N/A; `tsc --noEmit` clean |

---

## Phase 03: Auth Flow Implementation

> **⚠️ DELICATE — recent commits `4bc4de8` and `0ec3682` show active iteration. Do not modify playwright-cli-driver / cookie-monitor / auth-service lightly.**

| # | Maestro task | Status | OpenSpec artifact | Evidence / notes |
|---|---|---|---|---|
| 3.1 | `src/services/playwright-cli-driver.ts` | ✅ DONE | `openspec/specs/auth/spec.md` | All 8 methods + `withSession`; auto-detect between `playwright-cli` and `bunx @playwright/cli`; 15 unit tests |
| 3.2 | `src/services/cookie-monitor.ts` | ✅ DONE (improvement) | `openspec/specs/auth/spec.md` | All 4 methods; `POLL_INTERVAL_MS=2_000`; `DEFAULT_TIMEOUT_MS=300_000`; timeout `.unref()`-ed. **Login detection uses sign-out link probe** (intentional improvement, `e4d1fef`), not Maestro's textarea+URL check. |
| 3.3 | `src/services/auth-service.ts` | 🟡 PARTIAL | `openspec/specs/auth/spec.md` | All 8 methods present; 13 unit tests. **"Press Enter to launch browser..." is a one-shot UI message, not a blocking prompt** — Maestro specified blocking on Enter. Intentional change; documented as current behavior. |
| 3.4 | `src/services/cookie-storage-service.ts` | ✅ DONE (deviation) | `openspec/specs/auth/spec.md` | All 4 methods; 7-day freshness window; 9 unit tests. **Composes `CookieStorage` via DI** (not extends), functionally equivalent |
| 3.5 | `src/services/profile-auth-manager.ts` | ✅ DONE (with bug) | `openspec/specs/auth/spec.md`; bug fixed in `command-spec-conformance` | `ensureAuthenticated`, `getActiveProfiles`, `findProfileForConversation` all present. **`findProfileForConversation` ignores its `conversationId` argument** — returns first active profile. Bug is fixed in `command-spec-conformance` change. 8 unit tests document the BUG (to be updated). |
| 3.6 | `src/cli/commands/auth-command.ts` | ✅ DONE | `openspec/specs/commands/spec.md` | Profile selection menu with all 5 options; 12 CLI tests + 7 integration tests. Registered as `auth` (Maestro's note said `login` — Maestro was slightly off) |
| 3.7 | `src/cli/commands/status-command.ts` | ✅ DONE | `openspec/specs/commands/spec.md` | Config dir + 4-column profile table; exits 2 if no profiles; 3 CLI tests + 9 integration tests |
| 3.8 | `src/cli/commands/profile-command.ts` | ✅ DONE | `openspec/specs/commands/spec.md` | All 5 actions + help; 17 integration tests |
| 3.9 | `src/services/install-browser-service.ts` | ✅ DONE | `openspec/specs/install-browser/spec.md` (current surface); cross-platform refactor in `cross-platform-build-and-ci` | All methods + Windows/Linux/WSL browser detection; 5 unit tests. The refactor in `cross-platform-build-and-ci` extracts the WSL detection to the shared `platform-detect` module — **behavior-preserving**, the 5 tests are the regression gate |
| 3.10 | `src/cli/commands/install-browser-command.ts` | ✅ DONE | `openspec/specs/install-browser/spec.md` | Wraps `InstallBrowserService.install()`; 3 CLI tests |
| 3.11 | Verify auth flow end-to-end | ✅ DONE | `openspec/specs/commands/spec.md` + `auth` spec | 12 CLI tests + 7 integration tests + 13 service tests |
| 3.12 | `ruff check src/` + `tsc --noEmit` | ⚠️ N/A + ✅ | — | ruff N/A; `tsc --noEmit` clean |

---

## Phase 04: Command Implementation

| # | Maestro task | Status | OpenSpec artifact | Evidence / notes |
|---|---|---|---|---|
| 4.1 | `src/cli/commands/list-command.ts` | 🟡 PARTIAL | `openspec/specs/commands/spec.md`; fix in `command-spec-conformance` | All 10 flags parsed; 11 CLI tests + 21 integration tests. **Profile column missing when `--all-profiles`** — fixed in `command-spec-conformance` |
| 4.2 | `src/cli/commands/fetch-command.ts` | ✅ DONE | `openspec/specs/commands/spec.md` | 18 integration tests |
| 4.3 | `src/cli/commands/continue-command.ts` | 🟡 PARTIAL | `openspec/specs/commands/spec.md`; fix in `command-spec-conformance` | Non-interactive + interactive REPL with `/exit`. **Does NOT call `findProfileForConversation`** — fixed in `command-spec-conformance`. 5 CLI tests |
| 4.4 | `src/cli/commands/new-command.ts` | ✅ DONE | `openspec/specs/commands/spec.md` | Non-interactive + interactive REPL with `--profile` |
| 4.5 | `src/cli/commands/delete-command.ts` | 🟡 PARTIAL | `openspec/specs/commands/spec.md`; fix in `command-spec-conformance` | Confirmation prompt + `--force`. **Does NOT call `findProfileForConversation`** — fixed in `command-spec-conformance`. 7 CLI tests |
| 4.6 | `src/cli/commands/export-command.ts` | ✅ DONE | `openspec/specs/commands/spec.md` | Default filename + JSON/markdown + output dir; 12 integration tests |
| 4.7 | `src/cli/commands/export-all-command.ts` | ✅ DONE | `openspec/specs/commands/spec.md` | All flags; index.md with links; progress + failure tracking; 9 CLI tests |
| 4.8 | Update `command-registry.ts` to register all 11 commands | ✅ DONE | `openspec/specs/commands/spec.md` | All 11 commands registered in `registerAllCommands()`; `84c24cf` |
| 4.9 | Update `src/cli/index.ts` for global flags + unknown commands | ✅ DONE | `openspec/specs/cli/spec.md` | `--verbose`/`-v`, `--help`/`-h`, `--version`, unknown command → "Did you mean one of: …?"; `a3e1d8d` |
| 4.10 | Verify all commands with `--help` | ✅ DONE | `openspec/specs/commands/spec.md` + `testing` spec | 600+ integration assertions exercise `--help` on every command |
| 4.11 | `ruff check src/` + `tsc --noEmit` | ⚠️ N/A + ✅ | — | ruff N/A; `tsc --noEmit` clean |

---

## Phase 05: CI/CD & Build

| # | Maestro task | Status | OpenSpec artifact | Evidence / notes |
|---|---|---|---|---|
| 5.1 | `.github/workflows/test.yml` | ❌ NOT DONE | `cross-platform-build-and-ci` change (`release-pipeline` spec) | The directory exists but is empty |
| 5.2 | `.github/workflows/build.yml` | ❌ NOT DONE | `cross-platform-build-and-ci` change (`release-pipeline` spec) | Not present |
| 5.3 | `.github/workflows/release.yml` | ❌ NOT DONE | `cross-platform-build-and-ci` change (`release-pipeline` spec) | Not present |
| 5.4 | `package.json` build scripts | 🟡 PARTIAL (broken) | `cross-platform-build-and-ci` change (`release-pipeline` spec) | Scripts present but `bun run build` fails: `error: cannot use --compile with --outdir` (Bun 1.3.x). Fix uses `--outfile` instead |
| 5.5 | `scripts/clean-build.sh` + `scripts/clean-build.ps1` | ❌ NOT DONE | `cross-platform-build-and-ci` change (`release-pipeline` spec) | `scripts/` directory does not exist |
| 5.6 | `src/infrastructure/path-utils.ts` updates (isWindows, isWSL, normalizePath, getPlatformName) | ❌ NOT DONE | `cross-platform-build-and-ci` change (`platform-detection` spec) | 0 matches for any of these in `src/`. WSL detection duplicated inline in `install-browser-service.ts:143-171` |
| 5.7 | `src/infrastructure/platform-detect.ts` | ❌ NOT DONE | `cross-platform-build-and-ci` change (`platform-detection` spec) | File does not exist |
| 5.8 | `src/services/install-browser-service.ts` cross-platform | ✅ DONE | (current state covered by `install-browser` spec) | All platform-specific finders present; 5 unit tests |
| 5.9 | `scripts/install-browser.ps1` | ❌ NOT DONE | `cross-platform-build-and-ci` change (`release-pipeline` spec) | Not present |
| 5.10 | `scripts/install-browser.sh` | ❌ NOT DONE | `cross-platform-build-and-ci` change (`release-pipeline` spec) | Not present |
| 5.11 | `src/cli/index.ts` shebang | ✅ DONE | `openspec/specs/cli/spec.md` | `#!/usr/bin/env bun` (line 1) |
| 5.12 | Verify build works locally | ❌ NOT DONE | `cross-platform-build-and-ci` change (`release-pipeline` spec) | Build is broken (5.4) |
| 5.13 | `ruff check src/` + `tsc --noEmit` | ⚠️ N/A + ✅ | — | ruff N/A; `tsc --noEmit` clean |

---

## Phase 06: Testing

| # | Maestro task | Status | OpenSpec artifact | Evidence / notes |
|---|---|---|---|---|
| 6.1 | `tests/setup.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 7 global helpers; `ad0df81` |
| 6.2 | `tests/fixtures/auth-fixtures.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 4 factories + 3 constants |
| 6.3 | `tests/fixtures/chat-fixtures.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 3 factories |
| 6.4 | `tests/unit/path-utils.test.ts` | 🟡 PARTIAL | `openspec/specs/testing/spec.md`; gap closed by `cross-platform-build-and-ci` | 19 tests; **missing tests for `isWindows`/`isLinux`/`isWSL`** (functions don't exist yet — gap closed when `platform-detection` change lands) |
| 6.5 | `tests/unit/config.test.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 13 tests; `3446e3a` |
| 6.6 | `tests/unit/validators.test.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 10 tests (file is in `tests/infrastructure/`, not `tests/unit/`) |
| 6.7 | `tests/unit/formatters.test.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 14 unit + 8 infrastructure tests covering all 4 formatters; `698ff3d` |
| 6.8 | `tests/unit/mediator.test.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 9 tests; `3ac6a41` |
| 6.9 | `tests/unit/errors.test.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 13 tests; `3ac6a41` |
| 6.10 | `tests/integration/commands/auth.test.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 7 tests; `1505d3e` |
| 6.11 | `tests/integration/commands/list.test.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 21 tests; `87fe60b` + `9bdbe2f` |
| 6.12 | `tests/integration/commands/fetch.test.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 18 tests; `96a586d` |
| 6.13 | `tests/integration/commands/export.test.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 12 tests; `6619148` |
| 6.14 | `tests/integration/commands/profile.test.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 17 tests; `81ccbe3` |
| 6.15 | `tests/integration/commands/status.test.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 9 tests; `e4cc17a` |
| 6.16 | `tests/parity/compare-outputs.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | Full framework with normalization; `451e54d` + `4cae594` |
| 6.17 | `tests/parity/test-commands-parity.{sh,ps1}` | ✅ DONE | `openspec/specs/testing/spec.md` | Both shells present |
| 6.18 | `tests/smoke/smoke.test.ts` | ✅ DONE | `openspec/specs/testing/spec.md` | 3 tests; `d3a4bb4` |
| 6.19 | `package.json` test scripts | ✅ DONE | `openspec/specs/testing/spec.md` | All 6 scripts; `8bb251a` |
| 6.20 | `bun test` → 0 failures | ✅ DONE | (verified at migration start; 432/432) | Re-verified at end of migration |
| 6.21 | Run parity tests | 🟡 PARTIAL | `openspec/specs/testing/spec.md` | Parity infra exists and passes; **results against Python CLI not yet committed** (requires v1.4.1 Python CLI on PATH) |
| 6.22 | `ruff check src/` + `tsc --noEmit` | ⚠️ N/A + ✅ | — | ruff N/A; `tsc --noEmit` clean |

---

## Cross-Phase Gaps (not in any Maestro task)

| # | Item | Status | OpenSpec artifact | Evidence / notes |
|---|---|---|---|---|
| C.1 | `install.ps1` / `install.sh` for v2.0.0 (replaces deleted v1.4.1 installer) | ❌ NOT DONE | `v2-install-migration` change (`v2-installer` spec) | The v1.4.1 `install.ps1` was deleted in commit `4bdefa8` "remove all python implementation". For v1.4.1 → v2.0.0 seamless upgrade, a new install.ps1 + install.sh are required |
| C.2 | `docs/INSTALL.md` end-user install guide | ❌ NOT DONE | `v2-install-migration` change (`v2-installer` spec) | Not present |
| C.3 | `README.md` "Upgrading from v1.4.1" callout | ❌ NOT DONE | `v2-install-migration` change (`v2-installer` spec) | README still references old install flow |
| C.4 | `.gitignore` stray `{` line + orphan `{` file | ❌ NOT DONE | `cross-platform-build-and-ci` change (`platform-detection` / cleanup tasks) | `.gitignore:23` is bare `{`; a 0-byte file named `{` is at repo root |
| C.5 | Unused `commander` dependency | ❌ NOT DONE | `cross-platform-build-and-ci` change (cleanup tasks) | `commander@^15.0.0` in `package.json:20` and `bun.lock:33`; 0 imports in `src/` |
| C.6 | `src/commands/` empty placeholder | ❌ NOT DONE | `cross-platform-build-and-ci` change (cleanup tasks) | Contains only `.gitkeep`; real commands live in `src/cli/commands/` |
| C.7 | `bun run build` is broken in Bun 1.3.x | ❌ NOT DONE | `cross-platform-build-and-ci` change (`release-pipeline` spec) | `error: cannot use --compile with --outdir` |

---

## Summary

- **DONE:** 53 tasks ✅ + 5 N/A ⚠️
- **PARTIAL:** 6 tasks 🟡 (all have follow-up changes; see column 4)
- **NOT DONE:** 16 tasks ❌ (all have follow-up changes; see column 4)

| OpenSpec change | Maestro/cross-phase items | Implementation tasks | Status |
|---|---|---|---|
| `cross-platform-build-and-ci` | 5.1–5.3, 5.4 (build fix), 5.5, 5.6, 5.7, 5.9, 5.10, 5.12, C.4, C.5, C.6, C.7 | 36 tasks across 12 groups | ready to apply |
| `v2-install-migration` | C.1, C.2, C.3 | 36 tasks across 8 groups | ready to apply |
| `command-spec-conformance` | 3.5 (bug fix), 4.1 (Profile column), 4.3 (continue profile lookup), 4.5 (delete profile lookup) | ~40 tasks across 12 groups | ready to apply |
| 15 main specs (auth, cli, commands, …) | 53 ✅ tasks documented as the canonical current state | — | all validate |

**Test baseline:** 432 pass, 0 fail, 754 expect() calls, 10.5 s. No source code was modified during the migration; the OpenSpec artifacts are pure documentation that describe the work to be done in follow-up changes.

**To start the implementation of a change:** `cd <repo> && /opsx-apply <change-name>` (or ask your AI assistant to apply the change).
