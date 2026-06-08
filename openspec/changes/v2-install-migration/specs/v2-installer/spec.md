## ADDED Requirements

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
The system MUST attach a `install.sh` script to every GitHub release tagged `v*` that targets the v2.0.0+ series. The `install.sh` script MUST be a POSIX bash 3.2+ script that, when invoked as `curl -fsSL https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.sh | bash`, downloads the latest `GemiTerm` release asset, installs it to `~/.local/bin/gemiterm`, runs `gemiterm install-browser`, verifies Chromium is present, and writes a `source`-able snippet to `~/.config/gemiterm/env.sh` that is appended to `~/.bashrc` (and `~/.zshrc` if it exists) for `PATH` discovery.

#### Scenario: One-liner install on a fresh Linux machine
- **WHEN** a user with no prior GemiTerm install runs `curl -fsSL https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.sh | bash` in bash
- **THEN** the latest `GemiTerm` binary is downloaded to `~/.local/bin/gemiterm` (creating the directory if it does not exist), `chmod +x` is applied, `gemiterm install-browser` is invoked, and a `source` line for `~/.config/gemiterm/env.sh` is appended to `~/.bashrc` if not already present

#### Scenario: `gemiterm --version` reports the installed version on POSIX
- **WHEN** a user runs `gemiterm --version` after a successful POSIX install (in a new shell, or after `source ~/.config/gemiterm/env.sh`)
- **THEN** the command exits 0 and prints a version string of the form `gemiterm v2.x.y`

#### Scenario: POSIX install creates `~/.local/bin` if missing
- **WHEN** `install.sh` runs on a system where `~/.local/bin` does not exist
- **THEN** the directory is created with `mkdir -p` and the binary is placed inside; a message is printed if the directory was created

### Requirement: Upgrade From v1.4.1 Preserves User Data
The system MUST upgrade an existing v1.4.1 installation in place without modifying the user's profile data. The installer MUST detect an existing install by the presence of `GemiTerm.exe` at `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe` (Windows) or `gemiterm` at `~/.local/bin/gemiterm` (POSIX), MUST replace the binary atomically, and MUST NOT delete, move, or rewrite anything under `%APPDATA%\gemiterm\` (Windows) or `~/.config/gemiterm/` (POSIX).

#### Scenario: Binary replaced in place, config dir untouched on Windows upgrade
- **WHEN** a user with v1.4.1 already installed runs the v2.0.0 `install.ps1`
- **THEN** the binary at `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe` is overwritten, the installer prints `"Detected existing install at …; upgrading in place."`, and every file under `%APPDATA%\gemiterm\profiles\<name>\storage_state.json` is byte-identical to its pre-upgrade content (verified by hash)

#### Scenario: `.default` profile marker preserved on upgrade
- **WHEN** a user with v1.4.1 has a `.default` marker file under `%APPDATA%\gemiterm\profiles\` pointing to profile `work` and runs the v2.0.0 installer
- **THEN** after the upgrade, `%APPDATA%\gemiterm\profiles\.default` still exists, still contains `work` (or the prior content), and `gemiterm status` still lists `work` as the default profile

#### Scenario: `gemiterm status` shows the same profile list after upgrade
- **WHEN** a user runs `gemiterm status` before and after the v1.4.1 → v2.0.0 upgrade
- **THEN** both invocations print the same set of profile names and the same authentication-state column for each profile

### Requirement: `--uninstall` Removes Binary And PATH Entry, Preserves Config Dir
The system MUST support a `--uninstall` flag on both `install.ps1` and `install.sh`. The uninstall flow MUST delete the binary, remove the install dir from the persistent user `PATH` (or remove the `~/.config/gemiterm/env.sh` snippet and the `source` line from `~/.bashrc` / `~/.zshrc` on POSIX), and MUST NOT delete or modify the user's config dir at `%APPDATA%\gemiterm\` (Windows) or `~/.config/gemiterm/` (POSIX). After uninstall, a re-install MUST restore the binary and find the same profiles as before the uninstall.

#### Scenario: PowerShell uninstall removes binary and PATH entry, leaves config dir intact
- **WHEN** a user runs `pwsh -File install.ps1 --uninstall`
- **THEN** `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe` is deleted, `$env:LOCALAPPDATA\GemiTerm` is removed from the user `PATH` (persistent registry value), and `%APPDATA%\gemiterm\` is **NOT** deleted; the script prints `"GemiTerm uninstalled successfully."` and exits 0

#### Scenario: POSIX uninstall removes binary, env snippet, and bashrc source line, leaves config dir intact
- **WHEN** a user runs `bash install.sh --uninstall`
- **THEN** `~/.local/bin/gemiterm` is deleted, `~/.config/gemiterm/env.sh` is deleted, the `source ~/.config/gemiterm/env.sh` line is removed from `~/.bashrc` (and `~/.zshrc` if it exists), and `~/.config/gemiterm/profiles/` is **NOT** deleted

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
- **WHEN** `install.sh` runs and `~/.config/gemiterm/env.sh` is written and the `source` line is appended to `~/.bashrc` only if not already present (case-insensitive substring check)
- **THEN** a second `install.sh` run does not append a second `source` line and does not duplicate the `export PATH=...` line inside `env.sh`

### Requirement: install-browser Step Runs As Part Of Install And Is Verified
The system MUST invoke `gemiterm install-browser` as part of the install flow, MUST verify that Chromium is on disk after the invocation, and MUST exit non-zero with a clear message if the verification fails. The verification check is a glob over `$env:LOCALAPPDATA\ms-playwright\chromium-*\chrome.exe` (Windows) or `~/.cache/ms-playwright/chromium-*/chrome-linux/chrome` (POSIX).

#### Scenario: Fresh install downloads Chromium via install-browser
- **WHEN** `install.ps1` (or `install.sh`) runs on a system without Chromium
- **THEN** `gemiterm install-browser` is invoked, which downloads Chromium via Playwright, and the installer verifies the Chromium binary is present under the appropriate path before exiting 0

#### Scenario: install-browser failure fails the installer
- **WHEN** `gemiterm install-browser` exits non-zero (e.g. network failure during the Chromium download)
- **THEN** the installer prints `"Chromium installation verification failed. Re-run the installer after fixing the network, or run 'gemiterm install-browser' manually."` and exits non-zero; the existing binary (if upgrading) is left in place

#### Scenario: Re-install on a system with Chromium is a no-op for the browser step
- **WHEN** `install.ps1` (or `install.sh`) runs on a system that already has Chromium
- **THEN** `gemiterm install-browser` returns quickly (no re-download), the verification step confirms Chromium is present, and the installer exits 0

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
The system MUST NOT change the on-disk layout of the user config dir relative to v1.4.1. The Windows config dir MUST remain `%APPDATA%\gemiterm\`, the POSIX config dir MUST remain `~/.config/gemiterm/`, and the `GEMITERM_CONFIG_DIR` env-var override MUST be honored by the installed binary.

#### Scenario: Windows config path is unchanged
- **WHEN** a user inspects the config dir after install
- **THEN** profiles, cookies, and the `.default` marker live at `%APPDATA%\gemiterm\profiles\<name>\storage_state.json` and `%APPDATA%\gemiterm\profiles\.default` exactly as in v1.4.1

#### Scenario: POSIX config path is unchanged
- **WHEN** a user inspects the config dir after a POSIX install
- **THEN** profiles, cookies, and the `.default` marker live at `~/.config/gemiterm/profiles/<name>/storage_state.json` and `~/.config/gemiterm/profiles/.default` exactly as the v2.0.0 binary's path-utils expects

#### Scenario: GEMITERM_CONFIG_DIR override is honored
- **WHEN** a user sets `GEMITERM_CONFIG_DIR=/custom/path` and runs `gemiterm status`
- **THEN** the installed binary reads from `/custom/path` (overriding the platform default), as verified by `src/infrastructure/path-utils.ts:8-18`

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
