## Why

The Bun rewrite is functionally complete (432/432 tests pass, all 11 commands registered, auth flow working), but the **delivery pipeline is missing**: `bun run build` is broken in Bun 1.3.x (`--compile` no longer accepts `--outdir`), there is no CI to catch regressions on PRs, no cross-platform build matrix, no GitHub release automation, and no shared platform-detection module. Phase 5 of the Maestro plan captured all of this; the work was never started. Without it, the v2.0.0 binary that replaces v1.4.1 cannot be produced, tested in CI, or released.

## What Changes

- **Fix `package.json` build scripts** so `bun run build`, `bun run build:linux`, and `bun run build:windows` produce a working single-file executable on Bun 1.3.x (drop the `--outdir` flag from `--compile` invocations; use the entrypoint-adjacent output path).
- **Add `src/infrastructure/platform-detect.ts`** exporting `detectPlatform(): 'windows' | 'linux' | 'wsl' | 'darwin'` plus `isWindows()`, `isLinux()`, `isWSL()`, `isDarwin()`, and `getPlatformName()` helpers. Check `process.platform`, `/proc/version` for "microsoft" or "WSL", and `WSL_DISTRO_NAME`.
- **Extend `src/infrastructure/path-utils.ts`** with the shared `isWindows()`, `isWSL()`, `isLinux()`, `normalizePath()`, and `getPlatformName()` helpers (re-exported from `platform-detect.ts` for backward-compat) so command code and services share one detection source.
- **Refactor `src/services/install-browser-service.ts`** to consume the new shared platform module instead of carrying its own private WSL detection. **Behavior must not change** — the existing 5 unit tests in `tests/services/install-browser-service.test.ts` are the regression gate.
- **Add `.github/workflows/test.yml`**: trigger on `push` to `main` and on `pull_request`; single `test` job on `ubuntu-latest`; steps: `actions/checkout@v4`, `oven-sh/setup-bun@v2`, `bun install --frozen-lockfile`, `bun test`, `bun run typecheck`.
- **Add `.github/workflows/build.yml`**: trigger on `push` of tags matching `v*` and `workflow_dispatch`; matrix jobs `build-linux` (ubuntu-latest), `build-windows` (windows-latest), `build-wsl` (ubuntu-latest producing a WSL-compatible Linux binary); each verifies its artifact exists, reports size, and uploads via `actions/upload-artifact@v4`.
- **Add `.github/workflows/release.yml`**: trigger on `push` of tags matching `v*`; chain `test → build → release`; release job uses `softprops/action-gh-release@v2` with auto-generated notes and attaches both `GemiTerm` and `GemiTerm.exe` plus `install.ps1` and `install.sh`.
- **Add `scripts/clean-build.sh`** (POSIX) and **`scripts/clean-build.ps1`** (PowerShell) that remove `dist/` and any temp build artifacts. Both exit 0 on success and non-zero on error.
- **Add `scripts/install-browser.sh`** and **`scripts/install-browser.ps1`** as user-facing shell wrappers that run `bunx @playwright/cli install chromium` and verify the install (used during initial install on systems where the CLI binary is not yet on `PATH`).
- **Cleanup**: remove the unused `commander` dependency from `package.json` and `bun.lock` (it is installed but never imported — the CLI uses hand-rolled argv parsing). Remove the stray bare `{` line from `.gitignore` and the orphan file literally named `{` at the repo root. Decide whether `src/commands/` (empty placeholder) should be removed or repurposed; default is to remove it.
- **README updates**: add a "Building from source" section documenting `bun run build` / `bun run build:linux` / `bun run build:windows` and a "Release artifacts" section pointing at the v2.0.0 install scripts.

**No breaking changes** to the CLI user surface. All changes are internal build/CI work and one cosmetic `.gitignore` fix.

## Capabilities

### New Capabilities
- `release-pipeline`: GitHub Actions workflows (test, build, release) and the build/clean scripts that produce v2.0.0 cross-platform artifacts. Creates `openspec/changes/cross-platform-build-and-ci/specs/release-pipeline/spec.md`.
- `platform-detection`: The shared `src/infrastructure/platform-detect.ts` module exposing `detectPlatform()`, `isWindows()`, `isLinux()`, `isWSL()`, `isDarwin()`, and `getPlatformName()`. Re-exported helpers in `path-utils.ts` for backward compatibility. Creates `openspec/changes/cross-platform-build-and-ci/specs/platform-detection/spec.md`.

### Modified Capabilities
- (none) — no existing capability has a spec-level requirement change. The install-browser-service internal refactor is an implementation detail covered by the regression test gate.

## Impact

- **Code:** `src/infrastructure/path-utils.ts` (add 5 helpers), `src/services/install-browser-service.ts` (delegate to shared module — no behavior change), new `src/infrastructure/platform-detect.ts`, new `scripts/{clean-build,install-browser}.{sh,ps1}`, new `.github/workflows/{test,build,release}.yml`.
- **Build:** `package.json:24-26` (3 `build*` scripts) and `bun.lock` (drop `commander`).
- **Repo hygiene:** `.gitignore:23` (remove stray `{`) and the untracked file named `{` at the repo root. Possibly delete empty `src/commands/` (only `.gitkeep` inside).
- **Tests:** No new required tests, but the existing 5 `install-browser-service.test.ts` cases are the **regression gate** for the refactor. CI must pass with `bun test` and `bun run typecheck` (currently 432/432 passing).
- **README:** new "Building from source" and "Release artifacts" sections.
- **Docs dependency:** the related `v2-install-migration` change will reference these release artifacts.
- **SENSITIVE AREA:** the install-browser-service refactor MUST be behavior-preserving. The `playwright-cli-driver` and auth flow files are NOT touched by this change.
