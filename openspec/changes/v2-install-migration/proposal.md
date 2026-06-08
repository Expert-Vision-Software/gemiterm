## Why

GemiTerm v1.4.1 shipped with a PowerShell installer (`install.ps1` at the repo root) that downloaded the Python-built Windows binary from GitHub Releases into `$env:LOCALAPPDATA\GemiTerm\`, installed Chromium, and added the directory to the user `PATH`. That installer was **deleted in commit `4bdefa8`** ("remove all python implementation") when the Python codebase was removed. The new Bun-built v2.0.0 binary has **no installer at all** — there is no `install.ps1`, no `install.sh`, no `winget` manifest. End users who upgrade from v1.4.1 have no supported migration path, and new users have no supported install path. This change recreates the installer for v2.0.0, with explicit support for preserving the existing v1.4.1 user data (profiles, cookies, default profile marker) on upgrade.

## What Changes

- **Add `install.ps1` at the repo root** — PowerShell installer for Windows. Mirrors the v1.4.1 contract so existing user `PATH` entries and `%APPDATA%\gemiterm\` config keep working. Stages:
  1. If `--uninstall` is passed, run uninstall flow (delete binary, remove from `PATH`, leave config dir alone so a re-install keeps the user's data) and exit 0.
  2. If `GemiTerm.exe` already exists at `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe`, treat this as an **upgrade** from v1.4.1 → v2.0.0 (or a v2 → v2.0.x upgrade). Print "Detected existing install at …; upgrading in place." Do NOT delete the existing config dir.
  3. Resolve the GitHub release tag: by default use the latest release (`https://api.github.com/repos/expert-vision-software/GemiTerm/releases/latest`); honor an optional `-Tag v2.0.0` argument for canary/R installs.
  4. Download `GemiTerm.exe` (Windows asset) and `install.ps1` (this script) to `$env:LOCALAPPDATA\GemiTerm\`.
  5. Run `& $exePath install-browser` to install Chromium via playwright-cli.
  6. Verify Chromium is present under `$env:LOCALAPPDATA\ms-playwright\chromium-*\chrome.exe`. Fail loud if not.
  7. Add `$env:LOCALAPPDATA\GemiTerm` to user `PATH` **idempotently** (only append if not already present).
  8. Print final success: `"GemiTerm v2.0.0 installed. Run 'gemiterm status' to verify, then 'gemiterm auth' to authenticate."`.
- **Add `install.sh` at the repo root** — POSIX installer for Linux and WSL. Mirror of the Windows flow for `~/.local/bin/gemiterm` (XDG-style) and `~/.config/gemiterm/` (config) and `~/.cache/ms-playwright/` (Chromium). Supports `--uninstall`, upgrade-in-place, tag override via `GEMITERM_TAG` env var, idempotent `PATH` augmentation (writes a `~/.config/gemiterm/env.sh` snippet to be sourced from `~/.bashrc` / `~/.zshrc`).
- **Add `docs/INSTALL.md`** — End-user install guide covering both scripts, the upgrade flow, the uninstall flow, troubleshooting (e.g. "PATH did not refresh in current shell" → `refreshenv` / new shell), and the data-paths overview (binary vs config vs Chromium).
- **Update `README.md`** — Replace any v1.4.1 install instructions with a 1-line "see `docs/INSTALL.md`" pointer. Add a "Upgrading from v1.4.1" callout.
- **CI integration** — The release-pipeline workflow (`release.yml`, owned by the `cross-platform-build-and-ci` change) must attach `install.ps1` and `install.sh` to every GitHub release. Document this contract here as a cross-change dependency; the actual workflow file is owned by the other change.

**v1.4.1 → v2.0.0 data preservation (Windows):** The v1.4.1 Python and v2.0.0 Bun both store user data at `%APPDATA%\gemiterm\` (verified at `src/infrastructure/path-utils.ts:12-15`). Profile directories, `storage_state.json` cookies, and the `.default` marker are **all preserved across the upgrade** with no transformation. No migration script is needed for user data. The installer must simply NOT touch the config dir on upgrade.

**No breaking changes** to the CLI user surface. The installer is an addition; the CLI binary behaves identically.

## Capabilities

### New Capabilities
- `v2-installer`: The `install.ps1` and `install.sh` scripts that download, install, upgrade, and uninstall GemiTerm v2.0.0 across Windows, Linux, and WSL, with explicit v1.4.1 → v2.0.0 in-place upgrade support. Creates `openspec/changes/v2-install-migration/specs/v2-installer/spec.md`.

### Modified Capabilities
- (none) — no existing capability has a spec-level requirement change. The CLI behavior, config paths, and storage format are unchanged. The installer is a brand-new delivery surface.

## Impact

- **New files:** `install.ps1` (PowerShell), `install.sh` (POSIX shell), `docs/INSTALL.md`.
- **Modified files:** `README.md` (replace install section with pointer to `docs/INSTALL.md`; add upgrade callout).
- **No code changes** to `src/`. The installer scripts are external to the binary.
- **Cross-change dependency:** the `cross-platform-build-and-ci` change owns `.github/workflows/release.yml` and must attach both `install.ps1` and `install.sh` to each release. Coordinate via the `release-pipeline` capability's release-attach scenario. (If the other change has not landed first, the installer scripts in this repo are inert — they're only invoked by the install workflow.)
- **Tests:** New smoke test `tests/integration/installer-script-shape.test.ts` (or just a unit test) that validates the install scripts parse (PowerShell syntax check via `pwsh -NoProfile -Command "$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw install.ps1), [ref]$null)"` and Bash syntax check via `bash -n install.sh`). The scripts themselves are not exercised end-to-end in CI (no network, no real install).
- **Security:** the installer must verify the downloaded asset matches a known name (`GemiTerm.exe`, `install.ps1`) and use TLS via `Invoke-WebRequest` / `curl -fSL`. It must NOT execute arbitrary downloaded content beyond the named binary.
- **SENSITIVE AREA:** the installer scripts run the new `gemiterm install-browser` command during install, which touches the playwright-cli/Chromium subsystem. The user's troubleshooting history with cookie capture / subprocess spawning is NOT relevant here (the install-browser path is well-tested by `tests/services/install-browser-service.test.ts` and `tests/cli/install-browser-command.test.ts`). No code in `src/services/playwright-cli-driver.ts`, `cookie-monitor.ts`, or `auth-service.ts` is touched.
