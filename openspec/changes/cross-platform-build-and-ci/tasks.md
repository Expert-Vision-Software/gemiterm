## 1. Create platform-detect module

- [ ] 1.1 Create `src/infrastructure/platform-detect.ts` exporting `detectPlatform(): 'windows' | 'linux' | 'wsl' | 'darwin'`, `isWindows(): boolean`, `isLinux(): boolean`, `isWSL(): boolean`, `isDarwin(): boolean`, `getPlatformName(): 'windows' | 'linux' | 'wsl' | 'darwin'`, and `normalizePath(input: string): string`.
- [ ] 1.2 Implement `isWSL()` to read `/proc/version` and check for the substrings `microsoft` and `WSL` (case-insensitive) AND to check that the `WSL_DISTRO_NAME` env var is set and non-empty. Both signals MUST be combined with OR. Gate on `process.platform === 'linux'` so non-Linux platforms always return `false`.
- [ ] 1.3 Implement `normalizePath()` so it returns forward-slash paths on Windows and passes the input through unchanged on Linux/macOS. Empty input MUST return empty input without throwing.
- [ ] 1.4 Implement `detectPlatform()` with the precedence order: windows → wsl → linux → darwin → 'linux' default. `getPlatformName()` MUST be a thin alias of `detectPlatform()`.

## 2. Extend path-utils.ts with re-exports

- [ ] 2.1 Add `export { isWindows, isLinux, isWSL, isDarwin, detectPlatform, getPlatformName, normalizePath } from './platform-detect.ts';` to the bottom of `src/infrastructure/path-utils.ts` after the existing `export { ... }` block.
- [ ] 2.2 Run `bun test tests/unit/path-utils.test.ts` and confirm all 19 unit tests still pass. The new re-exports MUST NOT change the behavior of any existing helper (`resolvePath`, `getConfigDir`, `getProfilesDir`, `getProfilePath`, `getProfileDir`, `getDefaultProfileMarkerPath`).
- [ ] 2.3 Run `bun run typecheck` and confirm there are no new type errors. The re-exports MUST NOT create a circular import (verified by inspection: `platform-detect.ts` will not import from `path-utils.ts`).

## 3. Refactor install-browser-service to use the shared platform module

- [ ] 3.1 In `src/services/install-browser-service.ts`, delete the private `isWsl()` method (lines 143-149) and the `readFileSafe` helper if it is no longer used elsewhere. Replace every call to `this.isWsl()` with a call to the imported `isWSL()` from `../infrastructure/platform-detect.ts`.
- [ ] 3.2 Add `import { isWSL } from '../infrastructure/platform-detect.ts';` at the top of the file. Verify the new import does not create a cycle (it does not: `platform-detect.ts` does not import from `install-browser-service.ts`).
- [ ] 3.3 Confirm the behavior is preserved. The dispatch logic in `findSystemBrowser` (lines 57-65) and `findLinuxBrowser` (lines 102-122) MUST continue to behave identically. The new shared `isWSL()` is a strict superset of the old private `isWsl()` (adds `WSL_DISTRO_NAME` env var check), which is a strict improvement in detection coverage.
- [ ] 3.4 Run `bun test tests/services/install-browser-service.test.ts` and confirm all 5 unit tests still pass. The 432/432 baseline MUST be maintained across the full `bun test` run. **Do NOT touch `src/services/playwright-cli-driver.ts`, `src/services/cookie-monitor.ts`, or `src/services/auth-service.ts` in this task — they are sensitive and out of scope.**

## 4. Fix package.json build scripts

- [ ] 4.1 In `package.json:24-26`, change the three `build*` scripts to drop `--outdir` and use `--outfile dist/gemiterm` instead. Add a new `build:release` script that uses `--outfile dist/gemiterm --minify` to produce a minified, non-debug binary. The four final scripts MUST be: `build`, `build:linux`, `build:windows`, `build:release`.
- [ ] 4.2 Run `bun run build` on the current host. Verify a single-file binary is produced at `dist/gemiterm` (Linux/macOS) or `dist/gemiterm.exe` (Windows). Run `./dist/gemiterm --version` (or `dist\gemiterm.exe --version` on Windows) and confirm it exits 0 and prints the version string.
- [ ] 4.3 Run `bun run build:linux` and `bun run build:windows` and confirm the cross-compile produces a Linux binary (`dist/gemiterm`, no extension) and a Windows binary (`dist/gemiterm.exe`, with extension) respectively.
- [ ] 4.4 Run `bun run build:release` and confirm a minified binary is produced. Compare its size to the `bun run build` output — `build:release` MUST be at least as small as `build`.

## 5. Add clean-build shell scripts

- [ ] 5.1 Create `scripts/clean-build.sh` (POSIX) that removes `dist/` and any other transient build artifacts (e.g. `*.tsbuildinfo` if it appears). The script MUST `chmod +x` itself on first write, MUST `set -e` to fail on error, and MUST exit 0 when the cleanup succeeds (including when `dist/` does not exist).
- [ ] 5.2 Create `scripts/clean-build.ps1` (PowerShell Core) that performs the same cleanup. The script MUST use `$ErrorActionPreference = 'Stop'` and exit 0 on success.
- [ ] 5.3 Run `bash scripts/clean-build.sh` and `pwsh scripts/clean-build.ps1` locally and confirm both exit 0 and remove `dist/`.

## 6. Add install-browser shell scripts

- [ ] 6.1 Create `scripts/install-browser.sh` (POSIX) that runs `bunx @playwright/cli install chromium`, reports the command being run, captures stdout/stderr, and exits 0 on success. If Chromium is already installed (the `bunx` command is a no-op or prints a message about an existing install), the script MUST exit 0.
- [ ] 6.2 Create `scripts/install-browser.ps1` (PowerShell Core) that performs the same operation.
- [ ] 6.3 Run both scripts locally and confirm they exit 0. If Chromium is not already installed, the install MUST download and install it; if it is already installed, the scripts MUST exit 0 without re-downloading.

## 7. Add .github/workflows/test.yml

- [ ] 7.1 Create `.github/workflows/test.yml` with `on:` triggers for `pull_request` (any branch) and `push` (branches: `[main]`). Add a single `test` job that runs on `ubuntu-latest` with steps: `actions/checkout@v4`, `oven-sh/setup-bun@v2` with `bun-version: 1.3.13`, `bun install --frozen-lockfile`, `bun test`, `bun run typecheck`.
- [ ] 7.2 Add a `concurrency:` block at the workflow top that cancels in-progress runs on the same ref (`concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`).
- [ ] 7.3 Confirm the workflow file is valid YAML by running `actionlint` locally if available, or by pasting it into the GitHub Actions schema validator.

## 8. Add .github/workflows/build.yml

- [ ] 8.1 Create `.github/workflows/build.yml` with `on:` triggers for `push` (tags: `['v*']`) and `workflow_dispatch` (with an optional `tag` string input that defaults to the ref name). Add a `concurrency:` block that cancels in-progress tag builds.
- [ ] 8.2 Add a `build` job with `strategy.matrix.os: [ubuntu-latest, windows-latest]` and `strategy.matrix.target: [bun-linux-x64, bun-windows-x64]` plus an extra `build-wsl` job that runs on `ubuntu-latest` and produces a Linux x64 binary (no separate matrix entry, just a dedicated job). Each job MUST checkout, setup Bun 1.3.13, run `bun install --frozen-lockfile`, run the platform-specific `bun run build:linux` or `bun run build:windows` (or the WSL equivalent), verify the binary exists, report its size, and upload it via `actions/upload-artifact@v4` with a stable artifact name (`GemiTerm` for Linux/WSL, `GemiTerm.exe` for Windows).
- [ ] 8.3 Add a size verification step that fails the job if the binary is less than 20 MB (matches the Python reference's "exe too small" guard at `docs/python-release-for-reference.md:64-67`).
- [ ] 8.4 Confirm the workflow file is valid YAML.

## 9. Add .github/workflows/release.yml

- [ ] 9.1 Create `.github/workflows/release.yml` with `on:` triggers for `push` (tags: `['v*']`) only (no workflow_dispatch — release should only happen on a real tag). Add a `release` job that depends on `test` (from `test.yml`) and `build` (from `build.yml`) via the `needs:` keyword. Reference the cross-workflow needs using the job naming pattern `<workflow-name>/<job-name>` (for example `test.yml/test`, `build.yml/build`).
- [ ] 9.2 Add a `permissions:` block with `contents: write` on the release job so it can create the release. Add steps: `actions/checkout@v4`, `actions/download-artifact@v4` (to fetch `GemiTerm`, `GemiTerm.exe`, `install.sh`, and `install.ps1` artifacts), a "Determine tag" step that uses `${{ github.ref_name }}` for tag push events, and a final step using `softprops/action-gh-release@v2` with `generate_release_notes: true` and `files:` listing all four assets.
- [ ] 9.3 Confirm the workflow file is valid YAML.

## 10. Repo hygiene cleanup

- [ ] 10.1 Remove the orphan file literally named `{` at the repo root (`Remove-Item -LiteralPath '{' -Force` on Windows, or `rm '{'` on POSIX). The file is untracked, so this does not affect git history.
- [ ] 10.2 Edit `.gitignore:23` and remove the bare `{` line. Leave a blank line for readability.
- [ ] 10.3 In `package.json:29`, remove the `"commander": "^15.0.0"` entry from the `dependencies` block. The CLI uses hand-rolled argv parsing, not `commander`. Run `bun install` to regenerate `bun.lock` (line 9) and confirm `commander` is no longer listed in the lockfile's `packages` section.
- [ ] 10.4 Remove the `src/commands/` directory and its `.gitkeep` file (the directory is empty and unused). If `git log -- src/commands/` shows any historical content, leave a `.gitkeep` behind to preserve the directory.
- [ ] 10.5 Run `git status` and confirm only the intended files are staged for the cleanup.

## 11. README updates

- [ ] 11.1 Add a "Building from source" section to `README.md` after the "Development" section. Document the `bun run build`, `bun run build:linux`, `bun run build:windows`, and `bun run build:release` scripts and the resulting output paths (`dist/gemiterm` or `dist/gemiterm.exe`). State the minimum Bun version as 1.3.13.
- [ ] 11.2 Add a "Release artifacts" section to `README.md` after "Building from source". Document that the v2.0.0 release ships `GemiTerm` (Linux x64), `GemiTerm.exe` (Windows x64), `install.sh` (Linux/WSL installer), and `install.ps1` (Windows installer) as GitHub Release assets.
- [ ] 11.3 Update the "Development" section to mention the new `bun run typecheck` and the `scripts/clean-build.sh` / `scripts/install-browser.sh` wrappers as the user-facing browser install path.

## 12. Verification

- [ ] 12.1 Run `bun install --frozen-lockfile` to confirm the lockfile is in sync with `package.json` after the `commander` removal.
- [ ] 12.2 Run `bun test` and confirm the full suite passes (must stay at 432/432). In particular, all 5 tests in `tests/services/install-browser-service.test.ts` MUST pass (this is the regression gate for the platform-detect refactor).
- [ ] 12.3 Run `bun run typecheck` and confirm zero TypeScript errors. The new re-exports and refactored `install-browser-service.ts` MUST NOT introduce any new type errors.
- [ ] 12.4 Run `bun run build` and `bun run build:linux` and `bun run build:windows` and `bun run build:release` and confirm all four produce working executables.
- [ ] 12.5 Run `bash scripts/clean-build.sh`, `pwsh scripts/clean-build.ps1`, `bash scripts/install-browser.sh`, and `pwsh scripts/install-browser.ps1` and confirm all four exit 0.
- [ ] 12.6 Open a draft pull request to confirm the `test.yml` workflow runs against the change. The PR MUST NOT be merged until `test.yml` is green.
- [ ] 12.7 Push a `v2.0.0-rc.1` tag (do not push `v2.0.0` until the install scripts are confirmed working) to confirm `build.yml` and `release.yml` work end-to-end. Delete the tag and the draft release after verification.
