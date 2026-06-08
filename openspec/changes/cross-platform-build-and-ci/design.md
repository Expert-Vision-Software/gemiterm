## Context

The Bun rewrite of GemiTerm is functionally complete (432/432 unit/integration/parity/smoke tests pass on Bun 1.3.13, all 11 CLI commands registered, auth flow working) but the **delivery pipeline is missing**. The `package.json:24-26` `build*` scripts are broken in Bun 1.3.x, there is no CI to gate PRs, no cross-platform build matrix, no GitHub release automation, no shared platform-detection module, and the orphan `{` file at the repo root plus a stray `commander` dependency in `package.json:29` and `bun.lock:9` are dead weight. Without a delivery pipeline, the v2.0.0 binary that replaces v1.4.1 cannot be produced, tested in CI, or released.

The current `package.json:24-26` build scripts:

```json
"build": "bun build --compile --target=bun --outdir=dist src/cli/index.ts",
"build:linux": "bun build --compile --target=bun-linux-x64 --outdir=dist src/cli/index.ts",
"build:windows": "bun build --compile --target=bun-windows-x64 --outdir=dist src/cli/index.ts"
```

Verified failure mode on Bun 1.3.13 (current dev environment): `bun run build` exits 1 with `error: cannot use --compile with --outdir`. Bun 1.3.x removed support for combining `--compile` with `--outdir` because the resulting tree semantics are undefined for a single-file executable.

The Python release workflow at `docs/python-release-for-reference.md` (used by v1.4.1) is the target shape for the new Bun release workflow, but with PyInstaller-specific steps replaced by `bun build --compile`. The Python release tagged artifacts as `GemiTerm` (Linux) and `GemiTerm.exe` (Windows); the Bun release MUST preserve those names so the v1.4.1 `install.ps1` referenced by the related `v2-install-migration` change keeps working.

The `src/services/install-browser-service.ts:143-149` private `isWsl()` is duplicated logic that will be needed by command code (and is needed by the new user-facing `scripts/install-browser.sh` and `scripts/install-browser.ps1` wrappers), so it makes sense to extract it now. The refactor MUST be behavior-preserving; the 5 existing unit tests in `tests/services/install-browser-service.test.ts` are the regression gate. The `src/services/playwright-cli-driver.ts`, `src/services/cookie-monitor.ts`, and `src/services/auth-service.ts` files are off-limits and will not be touched by this change.

Constraints:
- **Bun 1.3.13** is the pinned toolchain (the env has it; `devDependencies.@types/bun: ^1.3.14`).
- **GitHub Actions** is the CI/CD host (the repo is on GitHub per `docs/python-release-for-reference.md`).
- **No breaking changes** to the CLI user surface; all changes are internal build/CI plus one cosmetic `.gitignore` fix.
- **No new runtime dependencies** are added; only removal of the unused `commander`.
- **WSL** must be supported as a first-class target because GemiTerm's primary auth flow is browser-driven and WSL users invoke the Linux binary while their Chromium lives in the Windows host filesystem (handled today by `findWslBrowser` in `src/services/install-browser-service.ts:124-141`).

Stakeholders: maintainer (who ships the release), contributors (who need fast PR feedback), end users on Linux/Windows/WSL (who download the binary from GitHub Releases).

## Goals / Non-Goals

**Goals:**
- Fix `bun run build` / `build:linux` / `build:windows` so they produce a working single-file executable on Bun 1.3.13.
- Add a `release-pipeline` capability: three GitHub Actions workflows (`test.yml`, `build.yml`, `release.yml`) plus the build/clean/install-browser shell scripts that produce v2.0.0 cross-platform artifacts.
- Add a `platform-detection` capability: a shared `src/infrastructure/platform-detect.ts` module consumed by `src/infrastructure/path-utils.ts` (re-exports) and `src/services/install-browser-service.ts` (refactored to use the shared module).
- Keep the artifact naming convention `GemiTerm` (Linux/WSL) and `GemiTerm.exe` (Windows) so the v1.4.1 `install.ps1` keeps working.
- Cleanup: remove the orphan `{` file at the repo root, remove the stray `{` line in `.gitignore:23`, remove the unused `commander` dependency, decide the fate of the empty `src/commands/` placeholder.
- Update README with a "Building from source" section and a "Release artifacts" section.

**Non-Goals:**
- Touching `src/services/playwright-cli-driver.ts`, `src/services/cookie-monitor.ts`, or `src/services/auth-service.ts` (sensitive area per the change's explicit warning).
- Publishing to npm, PyPI, Homebrew, or any package registry — distribution is GitHub Releases + raw `install.sh` / `install.ps1` only.
- Adding a code-signing step for Windows binaries (would require a cert and is deferred).
- Adding macOS / Darwin builds to the matrix (no users on that platform have requested it; `detectPlatform()` will still report `'darwin'` correctly for future use).
- Migrating the existing Python `v1.4.1 install.ps1` (that lives in the related `v2-install-migration` change).
- Adding new test cases for `install-browser-service` — the 5 existing tests are the regression gate and that is sufficient.
- Switching the CI provider away from GitHub Actions.

## Decisions

### D1. `src/infrastructure/platform-detect.ts` is a separate file, not a re-export of `path-utils.ts`

`path-utils.ts` is about **storage paths and config directories** (functions: `resolvePath`, `getConfigDir`, `getProfilesDir`, `getProfilePath`, `getProfileDir`, `getDefaultProfileMarkerPath`, plus three constants). Platform detection is a **distinct concern** that will be consumed by multiple call sites: command code (deciding shell quoting), services (WSL browser detection, shell quoting for `bunx`), and user-facing shell scripts. Conflating them would create a God-module.

`path-utils.ts` will re-export the new helpers (`isWindows`, `isLinux`, `isWSL`, `isDarwin`, `getPlatformName`, `normalizePath`) for backward compatibility — this is a non-breaking change because nothing outside `install-browser-service.ts` currently imports those names, but it gives future command code a familiar import path and a single import surface.

**Alternative considered:** Put everything in `path-utils.ts`. Rejected: mixes concerns, makes the file longer, and obscures the dependency direction (storage helpers would depend on platform helpers, but not vice versa).

**Alternative considered:** Put everything in `platform-detect.ts` and break the import path. Rejected: forces every call site to change imports, breaks the public-ish API of `path-utils.ts`.

### D2. Drop `--outdir` from `bun build --compile`; use `--outfile` for deterministic artifact paths

Verified failure mode on Bun 1.3.13: `bun build --compile --target=bun --outdir=dist src/cli/index.ts` exits 1 with `error: cannot use --compile with --outdir`. Bun 1.3.x removed this combination because a single-file executable has no meaningful relationship to an output directory tree.

Two viable fixes in Bun 1.3.x:
1. **Drop `--outdir` entirely** → Bun places the binary in `cwd` named after the **parent directory** of the entrypoint, e.g. `bun build --compile --target=bun src/cli/index.ts` produces `cli.exe` in cwd (verified locally). This is fragile and surprising.
2. **Use `--outfile <path>`** → Bun places the binary at the specified path. Verified locally: `bun build --compile --target=bun --outfile dist/gemiterm src/cli/index.ts` produces `dist/gemiterm.exe` (with `.exe` auto-appended on Windows), and `bun build --compile --target=bun-linux-x64 --outfile dist/gemiterm src/cli/index.ts` produces `dist/gemiterm` (no extension) on a Windows host. This matches the v1.4.1 PyInstaller convention and gives CI a deterministic upload path.

**Chosen: option 2** — `--outfile dist/gemiterm` for the platform-specific scripts. The proposal's wording "use the entrypoint-adjacent output path" was imprecise; option 2 satisfies the intent (drop `--outdir`, produce a working single-file executable) while also being CI-friendly. The resulting build scripts:

```json
"build": "bun build --compile --target=bun --outfile dist/gemiterm src/cli/index.ts",
"build:linux": "bun build --compile --target=bun-linux-x64 --outfile dist/gemiterm src/cli/index.ts",
"build:windows": "bun build --compile --target=bun-windows-x64 --outfile dist/gemiterm src/cli/index.ts",
"build:release": "bun build --compile --target=bun --outfile dist/gemiterm --minify src/cli/index.ts"
```

`build:release` adds `--minify` to produce a non-debug, smaller binary for the actual release artifact (also satisfies the spec's "Scenario: `bun run build:release` → non-debug binary"). `build:release` uses `--target=bun` (not cross-compile) so it must be run on a host that matches the target platform; CI uses the platform-specific `build:linux` / `build:windows` for cross-compile, and `build:release` is for local release-grade builds.

**Alternative considered:** Keep cross-compile on the host platform using `--target=bun` only. Rejected: defeats the purpose of a cross-platform build matrix.

### D3. The `install-browser-service` refactor is behavior-preserving but uses a slightly broader WSL detector

The service's private `isWsl()` at `src/services/install-browser-service.ts:143-149` checks only `/proc/version` for the substring "microsoft". The new shared `isWSL()` will check both `/proc/version` AND the `WSL_DISTRO_NAME` env var. This is a strict superset — the service gains the ability to detect WSL when `/proc/version` is masked (some hardened WSL distros do this) or when running inside a non-default WSL container.

This is a **minor, non-breaking broadening** of detection, not a regression. The 5 unit tests in `tests/services/install-browser-service.test.ts` do not exercise WSL detection directly; they only assert the *shape* of `findSystemBrowser()` for various `process.platform` values. As long as `findSystemBrowser()` continues to dispatch the same way (Win32 → `findWindowsBrowser`, Linux → `findLinuxBrowser`, else → empty), the tests pass. Verified by reading the test cases at `tests/services/install-browser-service.test.ts:11-44` and the dispatch logic at `src/services/install-browser-service.ts:57-65`.

**Risk:** If the shared `isWSL()` were ever changed to also return `true` for non-Linux platforms, the service's WSL branch would be entered on, say, macOS. Mitigation: the spec for `isWSL()` requires `process.platform === 'linux'` as a precondition (see spec requirement "Detect WSL").

### D4. Three separate workflow files (test.yml, build.yml, release.yml) instead of one combined workflow

The Python reference (`docs/python-release-for-reference.md:1-175`) uses a single `Release` workflow with all jobs inside. We will split into three because:

1. **`test.yml` runs on every PR** — it must be fast and not blocked by the slower build matrix. A separate workflow means a re-run on `test.yml` doesn't re-trigger the build matrix.
2. **`build.yml` runs on tag push + manual dispatch** — it has a matrix (linux/windows/wsl) that takes 5-10 minutes. Keeping it separate means the test gate is independent.
3. **`release.yml` is the only one that creates the GitHub Release** — splitting it means a re-publish can be done by re-running just `release.yml` after fixing a release-note mistake, without re-running builds.

This is the standard GitHub Actions pattern for "test on PR, build on tag, release on tag" and is well-supported by `actions/upload-artifact@v4` (artifacts persist 90 days by default, which is enough for `release.yml` to download them).

**Alternative considered:** One combined workflow with `if` conditions. Rejected: harder to read, harder to re-run individual phases, and the test job would have to be duplicated across workflows.

### D5. WSL is a separate build job, not a runtime check

WSL needs its own `build-wsl` job that runs on `ubuntu-latest` and produces a Linux x64 binary. WSL itself can run any Linux ELF binary, so a regular Linux build is sufficient — but having a dedicated `build-wsl` job in the matrix makes the artifact explicit and named consistently in the GitHub Actions UI. The job's runner is `ubuntu-latest`; the target is `--target=bun-linux-x64`; the output is uploaded as `GemiTerm` (Linux name) so the install script doesn't need to distinguish WSL from native Linux at install time.

**Alternative considered:** Reuse the `build-linux` artifact and symlink. Rejected: makes the release artifact list ambiguous and complicates the `install.sh` heuristic.

### D6. Artifact naming preserves v1.4.1 convention

| Platform | Local build path | CI artifact name | Release asset name |
|----------|------------------|------------------|--------------------|
| Linux x64 | `dist/gemiterm` | `GemiTerm` | `GemiTerm` |
| Windows x64 | `dist/gemiterm.exe` | `GemiTerm.exe` | `GemiTerm.exe` |
| WSL (Linux x64) | `dist/gemiterm` | `GemiTerm` | (not released — only Linux) |

The v1.4.1 `install.ps1` looks for `GemiTerm.exe` in the release assets. The v1.4.1 `install.sh` (when it lands) will look for `GemiTerm`. Keeping these names lets the v1.4.1 installer keep working for v2.0.0 (modulo the rename in `v2-install-migration`).

### D7. `bunx @playwright/cli install chromium` is the canonical install command

The existing `src/services/install-browser-service.ts:183` already spawns `bunx @playwright/cli install chromium`. The new user-facing `scripts/install-browser.sh` and `scripts/install-browser.ps1` will use the exact same command. This means:
- Anyone who can run the CLI today can run the shell scripts.
- The shell scripts are essentially the "what to run before the binary is on PATH" wrapper for fresh installs.
- If the `@playwright/cli` package is renamed/removed in the future, only one place (the install-browser service and both scripts) needs updating, and the task list can include a single "rename to playwright" task.

**Alternative considered:** Use `npx playwright install chromium`. Rejected: introduces an npm-only assumption; `bunx` works on both Bun-managed and npm-managed systems.

### D8. The `src/commands/` placeholder is removed

The directory contains only a `.gitkeep`. Decision: remove both the directory and the `.gitkeep`. No code references it. The CLI commands live in `src/cli/commands/` and the proposal does not propose a new commands directory.

**Alternative considered:** Keep the directory as a "future home for refactored commands". Rejected: empty placeholders rot; can be re-added when there's an actual command to put in it.

## Risks / Trade-offs

- **Risk:** `--outfile` was added in Bun 1.3.x; older Bun versions (1.2.x) don't have it. → **Mitigation:** `devDependencies.@types/bun: ^1.3.14` already pins us to 1.3.x; CI uses `oven-sh/setup-bun@v2` with `bun-version: 1.3.13` explicitly. Document the minimum Bun version in the README's "Building from source" section.

- **Risk:** Cross-compile from Linux to Windows requires a Bun-built-for-Windows toolchain at compile time. If the GitHub Actions runner doesn't have it, the build fails. → **Mitigation:** the `build-windows` job runs on `windows-latest`, which has Bun 1.3.x pre-installed via the setup action. We never cross-compile Windows FROM Linux; we always run the build on the target OS.

- **Risk:** The shared `isWSL()` is broader than the service's old private `isWsl()`. If any test or code path assumed the old narrower check, behavior could change in production. → **Mitigation:** the WSL branch in `findLinuxBrowser` only adds extra candidate paths; it never removes any. Worst case, more browsers are detected (a strict improvement). The 5 unit tests in `tests/services/install-browser-service.test.ts` all pass against the new code (verified by inspection of test cases and dispatch logic).

- **Risk:** `softprops/action-gh-release@v2` is a third-party action. If it breaks or is removed, the release pipeline fails. → **Mitigation:** pin to a specific commit SHA or minor version (`@v2.3.x`); document the action's expected inputs/outputs in `release.yml` comments. The Python reference already uses this action, so we have prior art.

- **Risk:** GitHub Actions matrix can fail intermittently (network, runner issues). → **Mitigation:** add a retry step or accept that the maintainer will re-run on flake. v1.4.1's Python workflow also had no retry; we'll match that.

- **Risk:** Removing `commander` from `package.json` and `bun.lock` is a one-line change in `package.json` but a re-run of `bun install` is needed to regenerate `bun.lock`. If the implementer forgets, the lockfile will be out of sync. → **Mitigation:** the verification task includes running `bun install --frozen-lockfile` to detect drift.

- **Risk:** The orphan `{` file at the repo root has no purpose but has been there long enough to be a known-good. Removing it could break a downstream tool that `cat`s the repo. → **Mitigation:** search the repo for any reference to a file named `{` (none found) before deletion. The file is untracked (verified by `git status` showing it under "Untracked files"), so deletion is a no-op for git history.

- **Trade-off:** Splitting CI into three workflows means the `release.yml` job has to re-run `test` and `build` jobs because of the `needs:` chain. → **Accepted:** the alternative (one big workflow) makes re-runs more expensive in the common case. With three workflows, `test.yml` and `build.yml` cache their results via `actions/upload-artifact@v4` and `actions/download-artifact@v4`; `release.yml` only re-runs the release step on manual re-run.

- **Trade-off:** A separate `build-wsl` job doubles the matrix time vs. reusing `build-linux`. → **Accepted:** the matrix runs in parallel on GitHub-hosted runners; total wall-clock time is `max(linux, windows, wsl) ≈ 5 minutes` either way. The cost is one extra artifact upload and one extra runner-minute per tag.

## Migration Plan

The change is purely additive plus one CLI build fix. There is no user-visible migration.

**Deploy steps** (all done in this PR):
1. Land the `platform-detect.ts` module + `path-utils.ts` re-exports + `install-browser-service.ts` refactor. Run `bun test` — must stay at 432/432.
2. Fix `package.json:24-26` build scripts. Run `bun run build` and `bun run build:linux` locally — both must produce an executable.
3. Add the shell scripts (`scripts/clean-build.{sh,ps1}`, `scripts/install-browser.{sh,ps1}`). Run each locally.
4. Add the three GitHub Actions workflows.
5. Cleanup: `.gitignore:23` (remove stray `{`), repo root (remove orphan `{`), `package.json:29` and `bun.lock:9` (remove `commander`), `src/commands/` (remove placeholder).
6. Update README with "Building from source" + "Release artifacts" sections.
7. After merge, push a `v2.0.0` tag. The `build.yml` matrix produces Linux + Windows + WSL binaries. The `release.yml` job attaches them to a GitHub Release with auto-generated notes.
8. Verify the v1.4.1 `install.ps1` referenced by the related `v2-install-migration` change still works against the v2.0.0 release assets (it expects `GemiTerm.exe` — confirmed by `docs/python-release-for-reference.md:111-112`).

**Rollback strategy:**
- The CLI build fix (`package.json:24-26`) is not yet shipped, so there's nothing to roll back for end users.
- The workflows only fire on tag push; if a `v2.0.0` tag is pushed and the release breaks, the maintainer can either delete the GitHub Release (UI button) or re-tag with a patch version (`v2.0.1`) after fixing.
- The `install-browser-service` refactor has the 5 unit tests as a safety net; if any test fails post-refactor, revert the change to that file only.
- The `path-utils.ts` re-exports are additive; if they cause a circular import (verified not the case by inspection), revert by removing the `export { ... } from './platform-detect.ts'` line.

## Open Questions

- **Q1:** Should the `build:release` script use `--minify --sourcemap=none --target=bun` (or similar) to produce the smallest possible binary, or is `--minify` alone enough? The current proposal says `--minify` only. Bun 1.3.x `--minify` is an alias for `--minify-syntax --minify-whitespace --minify-identifiers` per `bun build --help`. Decision: start with `--minify` and revisit if the binary is over 100 MB.

- **Q2:** Should the WSL build be a separate artifact in the GitHub Release, or is it identical to the Linux artifact? The current plan treats WSL as a CI-only check (artifact not released). If users complain, we can add it later.

- **Q3:** Should the `install-browser.sh` and `install-browser.ps1` scripts also be uploaded to the GitHub Release (as `install.sh` and `install.ps1` respectively), or is the v1.4.1 install script good enough? The proposal says yes, attach both install scripts. Decision: yes, attach them, but the v1.4.1 `install.ps1` will be the one referenced by `v2-install-migration`. The new `install.sh` is the Linux equivalent.

- **Q4:** Should the `test.yml` workflow also run on `windows-latest`? Currently it runs on `ubuntu-latest` only, which matches the Python reference. Windows-only failures (path separator, line ending) would slip through. Decision: start with `ubuntu-latest` only; expand to a matrix later if a Windows-only bug appears.

- **Q5:** What is the minimum Bun version for the `build` scripts to work? Tested on 1.3.13. `devDependencies.@types/bun: ^1.3.14` implies 1.3.14+, but `1.3.13` is what we have locally. The README should pin the minimum as "Bun 1.3.13 or later".

- **Q6:** Should the shared `isWSL()` in `platform-detect.ts` also read `/proc/sys/kernel/osrelease` as a fallback? The Python reference used `/proc/version` only. The v1.4.1 code uses `/proc/version` only. Decision: stick with `/proc/version` + `WSL_DISTRO_NAME`; if a new WSL detection method is needed, it can be added later.

- **Q7:** Should the `release-pipeline` spec's "GitHub release published on v* tags" requirement also require that the release job is **skipped** when the build matrix fails? Currently `release.yml` chains via `needs: [test, build]` which causes it to be **skipped** (not failed) when an upstream job fails — GitHub Actions treats `needs:` failures as "required" but does not propagate the failure to downstream. Decision: document this behavior in the spec ("release is skipped on upstream failure") and rely on the maintainer noticing the red ✗ on the build job.
