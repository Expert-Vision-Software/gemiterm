## Purpose

This capability defines the cross-platform one-liner installers for GemiTerm: a PowerShell Core 7+ script for Windows and a POSIX bash 3.2+ script for Linux and macOS. Both installers are attached to every GitHub release tagged `v*` in the v2.0.0+ series, download the binary release asset to a per-user install path, install Chromium for Playwright, augment the user `PATH` idempotently, and preserve the user's v1.4.1 config dir on upgrade. The installer scripts are syntax-validated in CI.

## Requirements

### Requirement: PowerShell Installer Ships With Every v2.0.0+ Release
The system MUST attach a `install.ps1` script to every GitHub release tagged `v*` that targets the v2.0.0+ series. The `install.ps1` script MUST be a PowerShell Core 7+ script that, when invoked as `irm https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.ps1 | iex`, downloads the latest `GemiTerm.exe` release asset, installs it to `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe`, runs `gemiterm install-browser`, verifies Chromium is present, and augments the user `PATH` idempotently.

#### Scenario: One-liner install on a fresh Windows machine
- **WHEN** a user with no prior GemiTerm install runs `irm https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.ps1 | iex` in PowerShell Core 7+
- **THEN** the latest `GemiTerm.exe` is downloaded to `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe`, `gemiterm install-browser` is invoked to install Chromium, the user `PATH` is augmented to include `$env:LOCALAPPDATA\GemiTerm`, and the script prints a success message

#### Scenario: Fresh install places binary at the v1.4.1-equivalent path
- **WHEN** `install.ps1` runs on a system with no prior install
- **THEN** the binary is placed at `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe` (note capital `G` in `GemiTerm`, matching the v1.4.1 install path) and a fresh `%APPDATA%\gemiterm\` config directory is created only if the user later runs `gemiterm` for the first time

#### Scenario: `gemiterm --version` reports the installed version
- **WHEN** a user runs `gemiterm --version` after a successful install
- **THEN** the command exits 0 and prints a version string of the form `gemiterm v2.x.y`

### Requirement: POSIX Installer Ships With Every v2.0.0+ Release
The system MUST attach a `install.sh` script to every GitHub release tagged `v*` that targets the v2.0.0+ series. The `install.sh` script MUST be a POSIX bash 3.2+ script that, when invoked as `curl -fsSL https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.sh | bash`, downloads the latest `GemiTerm` release asset, installs it to `~/.local/bin/gemiterm`, runs `gemiterm install-browser`, verifies Chromium is present, and writes a `source`-able snippet to `~/gemiterm/env.sh` that is appended to `~/.bashrc` (and `~/.zshrc` if it exists) for `PATH` discovery.

#### Scenario: One-liner install on a fresh Linux machine
- **WHEN** a user with no prior GemiTerm install runs `curl -fsSL https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.sh | bash` in bash
- **THEN** the latest `GemiTerm` binary is downloaded to `~/.local/bin/gemiterm` (creating the directory if it does not exist), `chmod +x` is applied, `gemiterm install-browser` is invoked, and a `source` line for `~/gemiterm/env.sh` is appended to `~/.bashrc` if not already present

#### Scenario: `gemiterm --version` reports the installed version on POSIX
- **WHEN** a user runs `gemiterm --version` after a successful POSIX install (in a new shell, or after `source ~/gemiterm/env.sh`)
- **THEN** the command exits 0 and prints a version string of the form `gemiterm v2.x.y`

#### Scenario: POSIX install creates `~/.local/bin` if missing
- **WHEN** `install.sh` runs on a system where `~/.local/bin` does not exist
- **THEN** the directory is created with `mkdir -p` and the binary is placed inside; a message is printed if the directory was created

### Requirement: Upgrade From v1.4.1 Preserves User Data
The system MUST upgrade an existing v1.4.1 installation in place without modifying the user's profile data. The installer MUST detect an existing install by the presence of `GemiTerm.exe` at `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe` (Windows) or `gemiterm` at `~/.local/bin/gemiterm` (POSIX), MUST replace the binary atomically, and MUST NOT delete, move, or rewrite anything under `%APPDATA%\gemiterm\` (Windows) or `~/gemiterm/` (POSIX).

#### Scenario: Binary replaced in place, config dir untouched on Windows upgrade
- **WHEN** a user with v1.4.1 already installed runs the v2.0.0 `install.ps1`
- **THEN** the binary at `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe` is overwritten, the installer prints `"Detected existing install at …; upgrading in place."`, and every file under `%APPDATA%\gemiterm\profiles\<name>\storage_state.json` is byte-identical to its pre-upgrade content (verified by hash)

#### Scenario: `.default` profile marker preserved on upgrade
- **WHEN** a user with v1.4.1 has a `.default` marker file under `%APPDATA%\gemiterm\profiles\` pointing to profile `work` and runs the v2.0.0 installer
- **THEN** after the upgrade, `%APPDATA%\gemiterm\profiles\.default` still exists, still contains `work` (or the prior content), and `gemiterm status` still lists `work` as the default profile

#### Scenario: `gemiterm status` shows the same profile list after upgrade
- **WHEN** a user runs `gemiterm status` before and after the v1.4.1 → v2.0.0 upgrade
- **THEN** both invocations print the same set of profile names and the same authentication-state column for each profile

#### Scenario: PowerShell installer detects Python v1.4.1 and prompts uninstall without touching config
- **WHEN** `install.ps1` runs and `pip show gemiterm` (or `gemiterm --version`) indicates a Python v1.4.1 install is present
- **THEN** the installer prints `"WARNING: Python v1.4.1 detected. Your config data at %APPDATA%\gemiterm\ is safe and will be preserved. Please run 'pip uninstall gemiterm' before re-running this installer to complete the v2.0.0 installation."` and exits non-zero; the existing binary is NOT replaced and no config data is modified

#### Scenario: POSIX installer detects Python v1.4.1 and prompts uninstall without touching config
- **WHEN** `install.sh` runs and `pip show gemiterm` (or `gemiterm --version`) indicates a Python v1.4.1 install is present
- **THEN** the installer prints `"WARNING: Python v1.4.1 detected. Your config data at ~/gemiterm/ is safe and will be preserved. Please run 'pip uninstall gemiterm' before re-running this installer to complete the v2.0.0 installation."` and exits non-zero; the existing binary is NOT replaced and no config data is modified

### Requirement: `--uninstall` Removes Binary And PATH Entry, Preserves Config Dir
The system MUST support a `--uninstall` flag on both `install.ps1` and `install.sh`. The uninstall flow MUST delete the binary, remove the install dir from the persistent user `PATH` (or remove the `~/gemiterm/env.sh` snippet and the `source` line from `~/.bashrc` / `~/.zshrc` on POSIX), and MUST NOT delete or modify the user's config dir at `%APPDATA%\gemiterm\` (Windows) or `~/gemiterm/` (POSIX). After uninstall, a re-install MUST restore the binary and find the same profiles as before the uninstall.

#### Scenario: PowerShell uninstall removes binary and PATH entry, leaves config dir intact
- **WHEN** a user runs `pwsh -File install.ps1 --uninstall`
- **THEN** `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe` is deleted, `$env:LOCALAPPDATA\GemiTerm` is removed from the user `PATH` (persistent registry value), and `%APPDATA%\gemiterm\` is **NOT** deleted; the script prints `"GemiTerm uninstalled successfully."` and exits 0

#### Scenario: POSIX uninstall removes binary, env snippet, and bashrc source line, leaves config dir intact
- **WHEN** a user runs `bash install.sh --uninstall`
- **THEN** `~/.local/bin/gemiterm` is deleted, `~/gemiterm/env.sh` is deleted, the `source ~/gemiterm/env.sh` line is removed from `~/.bashrc` (and `~/.zshrc` if it exists), and `~/gemiterm/profiles/` is **NOT** deleted

#### Scenario: Re-install after uninstall restores the binary and profiles
- **WHEN** a user runs `install.ps1` (or `install.sh`) after a prior `--uninstall`
- **THEN** the binary is re-installed at the same path and `gemiterm status` lists the same profiles that existed before the uninstall (proving the config dir was preserved across the uninstall/reinstall cycle)

### Requirement: Tag Override For Canary And Release-Candidate Installs
The system MUST accept a tag override on both installers. On PowerShell, the `-Tag <version>` parameter overrides the default "latest" release resolution. On POSIX, the `GEMITERM_TAG=<version>` environment variable overrides the default. When a tag is provided, the installer MUST fetch the named release (e.g. `v2.0.0-rc.1`) via `https://api.github.com/repos/expert-vision-software/GemiTerm/releases/tags/$Tag` and download the asset from `https://github.com/expert-vision-software/GemiTerm/releases/download/$Tag/`.

#### Scenario: PowerShell `-Tag` parameter downloads a specific release
- **WHEN** a user runs `pwsh -File install.ps1 -Tag v2.0.0-rc.1`
- **THEN** the installer fetches the `v2.0.0-rc.1` release from the GitHub API, downloads `GemiTerm.exe` from the `v2.0.0-rc.1` release assets, and installs it; `gemiterm --version` after install prints `gemiterm v2.0.0-rc.1` (or the equivalent)

#### Scenario: POSIX `GEMITERM_TAG` env var downloads a specific release
- **WHEN** a user runs `GEMITERM_TAG=v2.0.0-rc.1 bash install.sh`
- **THEN** the installer fetches the `v2.0.0-rc.1` release, downloads `GemiTerm` from the `v2.0.0-rc.1` release assets, installs it, and `gemiterm --version` prints the rc.1 version

#### Scenario: Default tag is "latest"
- **WHEN** a user runs the install one-liner with no `-Tag` and no `GEMITERM_TAG` env var
- **THEN** the installer fetches `https://api.github.com/repos/expert-vision-software/GemiTerm/releases/latest` and downloads the asset from the resolved tag

### Requirement: PATH Augmentation Is Idempotent
The system MUST add the install dir to the user `PATH` on a fresh install and MUST NOT add a duplicate entry on a re-install. On Windows, the comparison MUST be case-insensitive (Windows file paths are case-insensitive). On POSIX, the comparison MUST be case-sensitive (POSIX filesystems are case-sensitive by default). The current shell's `PATH` MUST also be updated so the user does not have to open a new terminal.

#### Scenario: Fresh install adds install dir to user PATH
- **WHEN** `install.ps1` runs and `$env:LOCALAPPDATA\GemiTerm` is not in the user `PATH`
- **THEN** the install dir is appended to the persistent user `PATH` (via `[Environment]::SetEnvironmentVariable('Path', ..., 'User')`) and to the current session's `$env:Path`

#### Scenario: Re-install does not duplicate the PATH entry
- **WHEN** `install.ps1` runs a second time and `$env:LOCALAPPDATA\GemiTerm` is already in the user `PATH` (case-insensitive match)
- **THEN** the user `PATH` is unchanged (no duplicate entry) and the script prints no "PATH updated" message

#### Scenario: POSIX install writes env.sh and appends source line to ~/.bashrc idempotently
- **WHEN** `install.sh` runs and `~/gemiterm/env.sh` is written and the `source` line is appended to `~/.bashrc` only if not already present (case-insensitive substring check)
- **THEN** a second `install.sh` run does not append a second `source` line and does not duplicate the `export PATH=...` line inside `env.sh`

### Requirement: Browser Install Step Runs As Part Of Install And Is Verified
The system MUST invoke `bunx @playwright/cli install-browser chrome-for-testing` directly (not via the `gemiterm install-browser` command) as part of the install flow, MUST verify that Chrome for Testing is on disk after the invocation, and MUST exit non-zero with a clear message if the verification fails. The verification check is a recursive glob over `$env:LOCALAPPDATA\ms-playwright\chromium-*\chrome.exe` (Windows) or `find ~/.cache/ms-playwright/chromium-* -name chrome -type f -executable` (POSIX) — both match the chrome-for-testing cache layout, which places the binary at `chromium-<rev>/chrome-linux64/chrome` on POSIX and `chromium-<rev>/chrome-win64/chrome.exe` on Windows.

#### Scenario: Fresh install downloads Chrome for Testing via playwright-cli
- **WHEN** `install.ps1` (or `install.sh`) runs on a system without Chrome for Testing and `bun` is in PATH
- **THEN** `bunx @playwright/cli install-browser chrome-for-testing` is invoked, which downloads Chrome for Testing via Playwright, and the installer verifies the binary is present under the appropriate path before exiting 0

#### Scenario: Bun not present on system — installer bootstraps Bun first
- **WHEN** `install.ps1` (or `install.sh`) runs and `bun` is not in PATH
- **THEN** the installer downloads and installs Bun via the official installer (`irm https://bun.sh/install.ps1 | iex` on Windows, `curl -fsSL https://bun.sh/install | bash` on POSIX) before running `bunx @playwright/cli install-browser chrome-for-testing`

#### Scenario: Bun bootstrap failure fails the installer
- **WHEN** the Bun bootstrap step fails (network error)
- **THEN** the installer prints `"Bun installation failed. Install Bun manually from https://bun.sh and re-run this installer."` and exits non-zero; the existing binary (if upgrading) is left in place

#### Scenario: playwright-cli install-browser failure fails the installer
- **WHEN** `bunx @playwright/cli install-browser chrome-for-testing` exits non-zero (e.g. network failure during the download)
- **THEN** the installer prints `"Chrome for Testing installation verification failed. Re-run the installer after fixing the network, or run 'bunx @playwright/cli install-browser chrome-for-testing' manually."` and exits non-zero; the existing binary (if upgrading) is left in place

#### Scenario: Re-install on a system with Chrome for Testing is a no-op for the browser step
- **WHEN** `install.ps1` (or `install.sh`) runs on a system that already has Chrome for Testing
- **THEN** `bunx @playwright/cli install-browser chrome-for-testing` returns quickly (no re-download), the verification step confirms the binary is present, and the installer exits 0

### Requirement: Network Failure Is Handled Gracefully
The system MUST detect when the GitHub API or the release download is unreachable and MUST exit non-zero with a clear remediation message. The installer MUST NOT replace the existing binary on a failed download (idempotency of the upgrade flow).

#### Scenario: api.github.com unreachable
- **WHEN** `install.ps1` (or `install.sh`) runs on a system where `https://api.github.com/repos/expert-vision-software/GemiTerm/releases/latest` returns a network error
- **THEN** the installer prints `"Cannot reach GitHub releases. Check your network connection or use the 'build from source' instructions in docs/INSTALL.md."` and exits non-zero; the existing binary (if any) is **NOT** modified

#### Scenario: Asset download fails mid-stream
- **WHEN** the download of `GemiTerm.exe` (or `GemiTerm`) starts but fails partway (e.g. connection reset)
- **THEN** the installer exits non-zero, the partial file is deleted (or, on Windows, not yet renamed into place), and the existing binary (if upgrading) is **NOT** replaced

#### Scenario: Existing binary is untouched on a failed install
- **WHEN** a fresh install fails partway and the user had an existing v1.4.1 binary
- **THEN** `gemiterm --version` after the failure still reports the v1.4.1 version (the original binary is byte-identical)

### Requirement: No Breaking Changes To User Data Or Config Paths
The system MUST NOT change the on-disk layout of the user config dir relative to v1.4.1. The Windows config dir MUST remain `%APPDATA%\gemiterm\`, the POSIX config dir MUST be `~/gemiterm/`, and the `GEMITERM_CONFIG_DIR` env-var override MUST be honored by the installed binary. The v1.4.1 source config dir at `~/.config/gemiterm/` is the **only** dir the installer may copy from; it MUST NOT be read, written, or deleted by v2.0.0 itself.

#### Scenario: Windows config path is unchanged
- **WHEN** a user inspects the config dir after install
- **THEN** profiles, cookies, and the `.default` marker live at `%APPDATA%\gemiterm\profiles\<name>\storage_state.json` and `%APPDATA%\gemiterm\profiles\.default` exactly as in v1.4.1

#### Scenario: POSIX config path is unchanged
- **WHEN** a user inspects the config dir after a POSIX install
- **THEN** profiles, cookies, and the `.default` marker live at `~/gemiterm/profiles/<name>/storage_state.json` and `~/gemiterm/profiles/.default` exactly as the v2.0.0 binary's path-utils expects

#### Scenario: GEMITERM_CONFIG_DIR override is honored
- **WHEN** a user sets `GEMITERM_CONFIG_DIR=/custom/path` and runs `gemiterm status`
- **THEN** the installed binary reads from `/custom/path` (overriding the platform default), as verified by `src/infrastructure/path-utils.ts:8-18`

### Requirement: v1.4.1 Config Dir Is Migrated Forward On First v2.0.0 Install
The system MUST detect a v1.4.1 config dir at `~/.config/gemiterm/` (the path v1.4.1 used on every platform; see `src/gemiterm/config.py:14` in the v1.4.1 reference at `C:\dev\projects\github\webgemini-cli`) and, on the first v2.0.0 install where the v2.0.0 target dir does not yet exist, MUST copy the v1.4.1 tree to the v2.0.0 location. The Windows target is `%APPDATA%\gemiterm\`; the POSIX target is `~/gemiterm/`. The v1.4.1 source dir MUST be left in place as a safety net. The copy is a one-time operation: if the v2.0.0 target dir already exists (e.g. from a prior install or manual setup), the copy MUST be skipped.

#### Scenario: Windows user with v1.4.1 Python config upgrades to v2.0.0
- **WHEN** a user with `~/.config/gemiterm/profiles/work/storage_state.json` and `%APPDATA%\gemiterm\` either missing or empty runs `install.ps1`
- **THEN** the installer copies the contents of `~/.config/gemiterm/` to `%APPDATA%\gemiterm\` (preserving `profiles/`, the `.default` marker, and any `storage_state.json` files byte-for-byte), prints `"v1.4.1 config copied to %APPDATA%\gemiterm\. The original at ... is left in place as a backup."`, and `gemiterm status` after install lists the same profile names that existed in the v1.4.1 dir

#### Scenario: POSIX user with v1.4.1 Python config upgrades to v2.0.0
- **WHEN** a user with `~/.config/gemiterm/profiles/work/storage_state.json` and `~/gemiterm/` either missing or empty runs `install.sh`
- **THEN** the installer copies the contents of `~/.config/gemiterm/` to `~/gemiterm/`, prints the equivalent copy message, and `gemiterm status` lists the same profile names as the v1.4.1 dir

#### Scenario: v2.0.0 target dir already exists — copy is skipped
- **WHEN** a user with `%APPDATA%\gemiterm\profiles\work\storage_state.json` (v2.0.0) and `~/.config/gemiterm\profiles\old\storage_state.json` (v1.4.1) runs `install.ps1`
- **THEN** the installer prints no copy message, `%APPDATA%\gemiterm\profiles\work\storage_state.json` is byte-identical to its pre-install hash, and `gemiterm status` lists `work` (not `old`) as the active profile

#### Scenario: Neither v1.4.1 nor v2.0.0 config exists — installer proceeds without copy
- **WHEN** a fresh-install user has neither `~/.config/gemiterm/` nor `%APPDATA%\gemiterm\` (or `~/gemiterm/`) and runs the installer
- **THEN** the installer does not print a copy message and does not create a config dir; the config dir is created lazily on the first `gemiterm auth` / `gemiterm list` invocation

### Requirement: Installer Prompts For Package-Manager Install When Bun Or Npm Is On PATH
The system MUST detect whether `bun` or `npm` is on `PATH` at install time. If either is present and stdin is a TTY, the installer MUST prompt the user with `"It is recommended to install via bun or npm package manager. Are you sure you want to continue with binary install? [y/N]"` and MUST default to N. The user MUST type `y` or `yes` to proceed with the binary install. If the user declines, the installer MUST print `"Aborted. Install via: bun i -g gemiterm"` (or `npm i -g gemiterm`, whichever is on PATH) and exit 0. The prompt MUST be suppressed when stdin is not a TTY (e.g. the `irm | iex` and `curl | bash` one-liner flows), so unattended installs proceed without blocking.

#### Scenario: User with bun on PATH answers the prompt with y
- **WHEN** `install.sh` runs in a TTY, `bun` is on PATH, and the user types `y` at the prompt
- **THEN** the installer proceeds with the binary download, install-browser, and PATH-augmentation steps, and exits 0

#### Scenario: User with npm on PATH answers the prompt with N (default)
- **WHEN** `install.ps1` runs in a TTY, `npm` is on PATH, and the user presses Enter (or types anything other than `y`/`yes`) at the prompt
- **THEN** the installer prints `"Aborted. Install via: npm i -g gemiterm"` and exits 0; no binary is downloaded and no `PATH` entry is added

#### Scenario: Unattended one-liner install with npm on PATH skips the prompt
- **WHEN** a user runs `irm ... | iex` or `curl -fsSL ... | bash` (stdin is not a TTY) and `bun`/`npm` is on PATH
- **THEN** the installer does not prompt and proceeds with the binary install

#### Scenario: Neither bun nor npm is on PATH — no prompt
- **WHEN** the installer runs and neither `bun` nor `npm` is on PATH
- **THEN** the installer does not print the prompt and proceeds with the binary install (the package-manager install is not an option for this user)

### Requirement: Installer Scripts Are Syntax-Validated In CI
The system MUST provide a CI gate that verifies both `install.ps1` and `install.sh` parse without syntax errors. The gate MUST be a single test file at `tests/integration/installer-script-shape.test.ts` that invokes the PowerShell parser API and `bash -n` on the scripts and fails the CI run if either reports an error.

#### Scenario: PowerShell parser accepts install.ps1
- **WHEN** CI runs `pwsh -NoProfile -Command "& { [System.Management.Automation.Language.Parser]::ParseFile('install.ps1', [ref]$null, [ref]$null) }"`
- **THEN** the command exits 0 and reports no parse errors

#### Scenario: Bash parser accepts install.sh
- **WHEN** CI runs `bash -n install.sh`
- **THEN** the command exits 0 and reports no syntax errors

#### Scenario: A malformed install script fails the shape test
- **WHEN** `install.sh` is edited to contain a syntax error (e.g. an unclosed brace)
- **THEN** `tests/integration/installer-script-shape.test.ts` fails in CI, blocking the merge; the failure message includes the `bash` error output for debugging
