## Why

The Bun rewrite is functionally complete (432/432 tests pass, all 11 commands registered, auth flow working), but the **delivery pipeline is missing**: `bun run build` is broken in Bun 1.3.x (`--compile` no longer accepts `--outdir`), there is no CI to catch regressions on PRs, no cross-platform build matrix, no GitHub release automation, and the rewrite's `src/` is full of direct `node:fs` and `node:path` imports that duplicate the same patterns in 4–8 places each (the "resolve + dirname + mkdirSync + writeFileSync" block alone appears in 4 export commands; `mkdirSync`/`existsSync`/`renameSync` are open-coded in `storage.ts` and `config.ts`).

Two findings drive the change:

1. **The build/CI/release work** — fixing `bun run build`, adding `test.yml` / `build.yml` / `release.yml` workflows, and the repo-hygiene cleanup — is the original scope and stands as-is.
2. **Path and file-system access is duplicated across the rewrite** and is the actual cross-platform work. A read-only audit of `src/` finds **9 files** importing `node:fs` and `node:path` directly, with at least 4 copy-pasted "write to disk" blocks and ~20 open-coded `mkdirSync` / `existsSync` / `renameSync` calls. The original spec proposed a `platform-detect.ts` module to share one private `isWsl()` helper, but the duplication is much wider: the rewrite does not need a platform-detection module — it needs **mandatory mediation** of all file-system and path operations through `src/infrastructure/path-utils.ts` and a new `src/infrastructure/io.ts`.

This change makes that mediation the rule, with a CI lint check that fails the build if any new `node:fs`/`node:path`/`node:os` import is added to `src/` outside the two allowed modules.

## What Changes

- **Fix `package.json` build scripts** so `bun run build`, `bun run build:linux`, and `bun run build:windows` produce a working single-file executable on Bun 1.3.x (drop the `--outdir` flag from `--compile` invocations; use `--outfile`).
- **Add `src/infrastructure/path-utils.ts` extensions**: `isWSL()`, `getProjectRoot()`, and `getPackageJson()`. The single private `isWsl()` in `install-browser-service.ts` is lifted into `path-utils.ts` (the only platform-detection helper we actually need; the rest of the proposed `platform-detect.ts` module is dropped).
- **Add `src/infrastructure/io.ts`**: a new sibling module that consolidates every `node:fs` and `node:path` operation the rewrite actually uses. Exports: `ensureDir`, `existsFile`, `readTextFile`, `safeReadTextFile`, `writeTextFile`, `readJsonFile`, `writeJsonFile`, `removeDir`, `renameDir`, `isDirectory`, `listSubdirectories`. This is the **canonical home for all file-system access**; the rule is "no other file in `src/` imports from `node:fs` or `node:path` directly" (the only allowed exception is `install-browser-service.ts`, which keeps `node:path` for the WSL mount parser).
- **Refactor `src/services/install-browser-service.ts`** to consume `isWSL()`, `safeReadTextFile`, `existsFile` from the new modules. The two near-identical `getEdgePaths` / `getChromePaths` methods are unified behind a `getWindowsKnownDirs()` local helper. The 5 existing unit tests in `tests/services/install-browser-service.test.ts` are the regression gate; the 432/432 baseline MUST be preserved.
- **Refactor `src/infrastructure/storage.ts` and `src/infrastructure/config.ts`** to route all file-system access through `io.ts`. `config.ts` shrinks from 64 lines to ~40; `storage.ts` loses all `node:fs` imports.
- **Refactor the 4 export commands** (`src/cli/commands/export-command.ts`, `export-all-command.ts`, `list-command.ts`, `fetch-command.ts`) to use `writeTextFile` and `ensureDir`. The 3-line "resolve + mkdir + write" block that appears in 4 places collapses to a single call. The two byte-identical `writeOutput` private methods in `list-command.ts` and `fetch-command.ts` each collapse to 2 lines.
- **Refactor `src/cli/index.ts`** to use `getPackageJson()` from `path-utils.ts` instead of the inline `fileURLToPath` / `__dirname` / `readFileSync` / `JSON.parse` dance at lines 33–35.
- **Add `.github/workflows/test.yml`**: trigger on `push` to `main` and on `pull_request`; single `test` job on `ubuntu-latest`; steps: `actions/checkout@v4`, `oven-sh/setup-bun@v2`, `bun install --frozen-lockfile`, `bun test`, `bun run typecheck`, and a final lint check that fails the build if any new `node:fs`/`node:path`/`node:os` import is added to `src/` outside the allowed files.
- **Add `.github/workflows/build.yml`**: trigger on `push` of tags matching `v*` and `workflow_dispatch`; matrix jobs `build-linux`, `build-windows`, and `build-wsl`; each verifies its artifact exists, reports size, and uploads via `actions/upload-artifact@v4`.
- **Add `.github/workflows/release.yml`**: trigger on `push` of tags matching `v*`; chains `test → build → release`; release job uses `softprops/action-gh-release@v2` with auto-generated notes and attaches `GemiTerm`, `GemiTerm.exe`, `install.sh`, and `install.ps1`.
- **Add `scripts/clean-build.sh`** (POSIX) and **`scripts/clean-build.ps1`** (PowerShell) that remove `dist/` and any temp build artifacts.
- **Add `scripts/install-browser.sh`** and **`scripts/install-browser.ps1`** as user-facing shell wrappers that run `bunx @playwright/cli install chromium` and verify the install.
- **Cleanup**: remove the unused `commander` dependency from `package.json` and `bun.lock` (it is installed but never imported). Remove the stray bare `{` line from `.gitignore` and the orphan file literally named `{` at the repo root. Remove the empty `src/commands/` placeholder (contains only `.gitkeep`).
- **README updates**: add a "Building from source" section and a "Release artifacts" section; update the "Development" section to mention the new `bun run typecheck` and the `scripts/install-browser.{sh,ps1}` wrappers.

**No breaking changes** to the CLI user surface. The 4 export commands keep their existing flags and behavior; the rewrite is purely internal refactoring plus build/CI.

## Capabilities

### New Capabilities

- `release-pipeline`: GitHub Actions workflows (test, build, release), the build/clean scripts, the install-browser shell wrappers, and the repo-hygiene cleanup. Creates `openspec/changes/cross-platform-build-and-ci/specs/release-pipeline/spec.md`.
- `path-and-file-mediation`: A mandatory mediation layer that makes `src/infrastructure/path-utils.ts` and the new `src/infrastructure/io.ts` the only consumers of `node:fs`, `node:path`, and `node:os` in `src/`. Adds `isWSL()`, `getProjectRoot()`, and `getPackageJson()` to `path-utils.ts`; adds the file-ops helpers to the new `io.ts`. Refactors all 7 existing call sites to use the new helpers. Adds a CI lint check that enforces the rule on every PR. Creates `openspec/changes/cross-platform-build-and-ci/specs/path-and-file-mediation/spec.md`.

### Modified Capabilities

- (none) — no existing capability has a spec-level requirement change. The `install-browser-service` refactor is an implementation detail covered by the regression test gate.

## Impact

- **Code:** `src/infrastructure/path-utils.ts` (add 3 helpers), new `src/infrastructure/io.ts` (~120 lines), `src/services/install-browser-service.ts` (delegate to shared module — no behavior change), `src/infrastructure/storage.ts` (lose 6 `node:fs` imports, shrink to use `io.ts` helpers), `src/infrastructure/config.ts` (shrink from 64 to ~40 lines), `src/cli/commands/{export,export-all,list,fetch}-command.ts` (lose `node:fs`/`node:path` imports, replace 3-line write block with `writeTextFile`), `src/cli/index.ts` (lose `node:url`/`node:path`/`node:fs` imports).
- **Build:** `package.json:20-22` (3 `build*` scripts) and `bun.lock` (drop `commander`).
- **Tests:** Add ~15–20 tests to `tests/unit/path-utils.test.ts` for the new path-utils helpers. Add `tests/infrastructure/io.test.ts` with ~15 tests for the new `io.ts` helpers. The existing 5 `install-browser-service.test.ts` cases are the regression gate for the `install-browser-service` refactor. CI must pass with `bun test` (currently 432/432) and `bun run typecheck` (currently 0 errors).
- **Repo hygiene:** `.gitignore:23` (remove stray `{`) and the untracked file named `{` at the repo root. Delete empty `src/commands/` (only `.gitkeep` inside).
- **README:** new "Building from source" and "Release artifacts" sections; update "Development" section.
- **Docs dependency:** the related `v2-install-migration` change will reference the release artifacts and the v2.0.0 install scripts.
- **SENSITIVE AREA:** the `install-browser-service` refactor MUST be behavior-preserving. The `playwright-cli-driver` and auth flow files are NOT touched by this change. The CI lint check is the enforcement mechanism for the "no direct `node:fs`" rule; existing code is migrated by hand as part of this change.
