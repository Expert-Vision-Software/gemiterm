## Context

GemiTerm v1.4.1 shipped a PowerShell installer (`install.ps1` at the repo root) that placed the Python-built binary at `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe`, installed Chromium, and added the directory to the user `PATH`. That installer was deleted in commit `4bdefa8` ("remove all python implementation") and the new Bun-built v2.0.0 binary has **no installer at all** — no `install.ps1`, no `install.sh`, no `winget` manifest. End users upgrading from v1.4.1 have no supported migration path, and new users have no supported install path. The v2.0.0 binary produced by the sibling `cross-platform-build-and-ci` change cannot reach users without a delivery script.

The v1.4.1 reference installer at `C:\dev\projects\github\webgemini-cli\install.ps1` (read-only) establishes the v1.4.1 contract: it does a `Invoke-RestMethod` against `api.github.com/repos/expert-vision-software/GemiTerm/releases/latest`, downloads `GemiTerm.exe` from the matched release asset, runs `& $exePath install-browser`, verifies Chromium at `$env:LOCALAPPDATA\ms-playwright\chromium-*\chrome.exe`, and idempotently augments user `PATH` with `$env:LOCALAPPDATA\GemiTerm` (note: **capital G** for the install dir, matching the v1.4.1 directory). Its `--uninstall` path deletes the binary and removes the `PATH` entry but leaves the user's `%APPDATA%\gemiterm\` config dir intact.

Verified by reading `src/infrastructure/path-utils.ts:8-18`: the v2.0.0 binary reads its config from the same `%APPDATA%\gemiterm\` (Windows) and `~/.config/gemiterm/` (POSIX) locations, with the same `GEMITERM_CONFIG_DIR` env-var override. The `.default` marker file and `profiles/<name>/storage_state.json` shape (`path-utils.ts:4-6`) are unchanged. This is what makes the v1.4.1 → v2.0.0 upgrade a true **in-place, no-transform** migration: the config dir keeps working, the install dir keeps the same path, and `install-browser` is idempotent (the 5 unit tests in `tests/services/install-browser-service.test.ts` and 3 in `tests/cli/install-browser-command.test.ts` are the regression gate).

Constraints:
- **PowerShell Core 7+** for `install.ps1`; the v1.4.1 script was Windows PowerShell 5-only syntax. The v2 script must use PowerShell Core syntax (e.g. `Split-Path -Parent $PSCommandPath` for self-locating) because GitHub Actions Windows runners ship only `pwsh`.
- **Bash 3.2+** for `install.sh` to support macOS's ancient default. No `bashisms` beyond `local`, `[[ ]]`, and `$( )` (all POSIX-safe).
- **No network in CI**: the install scripts themselves are not exercised end-to-end in CI (the GitHub Actions runners are isolated and the test suite is hermetic). A syntax-shape test (`pwsh -NoProfile -Command "[Parser]::ParseFile(...)"` and `bash -n`) is the only in-CI gate.
- **SENSITIVE AREA**: the install-browser step that runs `gemiterm install-browser` touches the playwright-cli/Chromium subsystem. No code in `src/services/playwright-cli-driver.ts`, `src/services/cookie-monitor.ts`, or `src/services/auth-service.ts` is touched by this change; the 5+3 existing tests are the regression gate.
- **TLS-only downloads**: `Invoke-WebRequest` and `curl -fSL` enforce HTTPS; the scripts MUST NOT follow HTTP redirects to non-HTTPS.
- **No code-signing**: the Windows binary is unsigned, so the installer cannot verify a signature. Mitigation: pin the release tag and match asset names exactly.

Stakeholders: end users (install/upgrade/uninstall), maintainer (releases), security reviewers (TLS, no arbitrary code execution).

## Goals / Non-Goals

**Goals:**
- Ship `install.ps1` (PowerShell Core) and `install.sh` (POSIX bash) at the repo root that install, upgrade, and uninstall GemiTerm v2.0.0.
- Mirror the v1.4.1 contract for the **directory and asset names** (`$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe`, `~/.local/bin/gemiterm`) so existing `PATH` entries and shell history keep working across the upgrade.
- Preserve v1.4.1 user data on upgrade: `%APPDATA%\gemiterm\` (Windows) and `~/.config/gemiterm/` (POSIX) are never deleted by the installer.
- Make `PATH` augmentation **idempotent** on both platforms (no duplicate entries, case-insensitive comparison on Windows).
- Support tag override for canary/R installs (`-Tag v2.0.0-rc.1` for PowerShell, `GEMITERM_TAG=v2.0.0-rc.1` for bash).
- Run `gemiterm install-browser` as part of install; fail loud if Chromium is not verified after the install-browser step.
- Document the offline / build-from-source fallback in `docs/INSTALL.md` because the installer is the only **online** install path on Windows (no `winget` manifest, no Chocolatey package).

**Non-Goals:**
- Modifying `src/services/playwright-cli-driver.ts`, `src/services/cookie-monitor.ts`, or `src/services/auth-service.ts` (sensitive area; the install-browser path is well-tested already).
- Adding `winget` / `scoop` / Homebrew / Linux-package-manager manifests. The release-attach contract for the existing assets is the deliverable; package-manager registrations are a separate effort.
- Code-signing the Windows binary or installer (deferred; no cert available).
- Cross-compiling the installer scripts from one shell to the other (e.g. `powershell → bash` transpiler). Each script is hand-written for its platform.
- Adding macOS-specific installer logic (the v1.4.1 `install.ps1` is Windows-only; `install.sh` will work on macOS for completeness but is not tested or documented as a primary install path).
- Auto-elevating to admin / using sudo for `~/.local/bin` (XDG user dir is per-user and writable without elevation; `/usr/local/bin` is explicitly out of scope).

## Decisions

### D1. Two scripts (`.ps1` and `.sh`) — one per platform family, not one cross-platform script

Windows shell and POSIX shell are not a single language. A "portable" script (e.g. one that branches on `$PSVersionTable` vs `$BASH_VERSION`) becomes unreadable and is hostile to anyone trying to copy-paste a one-liner. The two ecosystems have different conventions:
- Windows: `irm ... | iex` (PowerShell Core `Invoke-RestMethod` + `Invoke-Expression`) is the conventional install bootstrap. The user does **not** save the script first; it streams into the shell.
- POSIX: `curl -fsSL ... | bash` is the conventional install bootstrap. The script is usually self-contained (no need to save separately) but a multi-line snippet is fine.

Each script is hand-written for its target shell. They share the **contract** (what flags, what files, what `PATH` behavior, what uninstall behavior) but not the code. The GitHub release assets are named `install.ps1` and `install.sh` to match what the one-liner in `docs/INSTALL.md` downloads.

**Alternative considered:** One Python installer invoked by both `python3 -c "..."` and `py -3 -c "..."`. Rejected: requires Python on the user's machine (the binary's whole point is that it does not need Python) and breaks the `irm | iex` Windows convention.
**Alternative considered:** Bun as the installer runtime (`bun run install.ts`). Rejected: forces the user to install Bun before installing GemiTerm — defeats the purpose of a Bun-built binary that has no runtime dep.

### D2. `~/.local/bin/gemiterm` on Linux/WSL, not `/usr/local/bin` or `~/bin`

`~/.local/bin` is the XDG user-dir standard (`XDG_BIN_HOME` per the XDG Base Directory Specification). It is writable without `sudo` on every modern Linux distro, and is on `PATH` by default on Debian 12+, Ubuntu 23.04+, Fedora 38+, and Arch. On distros where it isn't, the user gets a clear remediation (`export PATH="$HOME/.local/bin:$PATH"` written to `~/.config/gemiterm/env.sh`).

- **`/usr/local/bin`**: requires `sudo`, breaks the per-user install model, and surprises users when they uninstall and the file persists.
- **`~/.bin`**: non-standard; not on `PATH` by default on any major distro.
- **`~/bin`**: only on `PATH` if it exists and the user's shell has the right snippet in `.profile` (Debian does, but only if the dir exists; macOS does not). Non-portable.

The install path is `~/.local/bin/gemiterm` (no extension; the Bun binary has no `.exe` suffix on POSIX). This is **different** from the Windows install path of `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe` — the difference is intentional and is documented in `docs/INSTALL.md` as a platform difference, not an inconsistency.

**Alternative considered:** `/opt/gemiterm/gemiterm`. Rejected: requires `sudo` and is unusual for a per-user CLI tool.
**Alternative considered:** Symlink the binary into `~/.local/bin` from a versioned install dir at `~/.local/share/gemiterm/`. Rejected: complicates the upgrade flow (atomic replace of the binary, vs. a symlink that needs `ln -sf`); a single binary at `~/.local/bin/gemiterm` is the v1.4.1-equivalent shape.

### D3. Shell snippet at `~/.config/gemiterm/env.sh` sourced from `~/.bashrc`, not a symlink in `PATH`

After installing to `~/.local/bin/gemiterm`, the binary is on `PATH` for **new shell sessions** but not for the **current** shell. Two ways to make it discoverable in the current shell:

1. **Symlink** approach: `install.sh` would put the binary in `~/.local/bin/gemiterm` and the user's shell would pick it up the next time they open a terminal. No current-shell update.
2. **Shell snippet** approach: `install.sh` writes a 1-line `export PATH="$HOME/.local/bin:$PATH"` to `~/.config/gemiterm/env.sh` and appends `[[ -f ~/.config/gemiterm/env.sh ]] && source ~/.config/gemiterm/env.sh` to `~/.bashrc` (and `~/.zshrc` if present). The user can `source ~/.config/gemiterm/env.sh` in the current shell for an immediate update.

The shell-snippet approach is chosen because:
- **Discoverability**: `~/.config/gemiterm/env.sh` is owned by GemiTerm; the user can `cat` it and see exactly what GemiTerm added to their shell environment. A symlink in `PATH` is invisible.
- **Idempotency**: appending a `source` line to `~/.bashrc` is a one-liner that's easy to check for duplication. A symlink farm is harder to audit.
- **Per-user isolation**: `~/.config/gemiterm/` is the same XDG-config root the v2.0.0 binary uses for its own data. Co-locating the env snippet in the config dir means `gemiterm config-dir` (if added later) prints a path the user already understands.

The snippet is **only** appended if the line is not already present (case-insensitive substring check). The uninstall flow removes the snippet and the `source` line.

**Alternative considered:** Print "Add `~/.local/bin` to your PATH" as a manual instruction and don't touch `~/.bashrc`. Rejected: every Linux install script for the last 10 years has done the `~/.bashrc` append (Rustup, nvm, fnm, deno). The user's expectation is set; the snippet is the standard pattern.
**Alternative considered:** Use `~/.profile` instead of `~/.bashrc`. Rejected: `~/.profile` is sourced by login shells only, not by interactive non-login shells (the default for most terminal emulators on Ubuntu/Fedora). The user would have to log out and back in, which is a worse UX than reopening a terminal.

### D4. Upgrade flow is "overwrite in place" — never "uninstall then install"

The v1.4.1 → v2.0.0 upgrade must not touch the config dir. The binary at `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe` (Windows) or `~/.local/bin/gemiterm` (POSIX) is replaced atomically (write to a `.new` sibling, then `Move-Item -Force` / `mv` to overwrite). The config dir at `%APPDATA%\gemiterm\` (Windows) or `~/.config/gemiterm/` (POSIX) is left untouched. `install-browser` is idempotent: re-running it on a system that already has Chromium is a no-op (verified by reading the 5 unit tests in `tests/services/install-browser-service.test.ts`).

The "Detected existing install at …; upgrading in place." message tells the user this is a v1.4.1 → v2.0.0 (or v2.x → v2.y) upgrade, **not** a fresh install, and that their data is preserved. This matches the v1.4.1 installer's behavior of always overwriting in place (the v1.4.1 script has no uninstall step on upgrade — it just downloads and overwrites).

**Alternative considered:** Detect v1.4.1 vs v2.x by reading the binary's `--version` output before downloading. Rejected: requires executing the existing binary, which is brittle (the v1.4.1 binary may not respond to `--version` the same way as the v2.0.0 one). The presence of `GemiTerm.exe` at the install path is sufficient signal.
**Alternative considered:** Use a side-by-side install (v1.4.1 stays at `GemiTerm-v1.exe`, v2.0.0 installs as `GemiTerm.exe`). Rejected: doubles disk usage, complicates uninstall, and the contract for v2.0.0 is "this replaces v1.4.1".

### D5. Download fallback is "build from source", not "pip install"

The v1.4.1 installer's fallback when GitHub is unreachable is "run `pip install gemiterm`" — the v1.4.1 binary was a Python wheel. The v2.0.0 binary is a Bun single-file executable with no `pip` equivalent. The v2.0.0 fallback is:
1. `git clone https://github.com/expert-vision-software/GemiTerm.git`
2. `cd GemiTerm && bun install && bun run build`
3. The resulting `dist/gemiterm` (or `dist/gemiterm.exe`) is the user-built binary, moved to the install path.

This is documented in `docs/INSTALL.md` under "Troubleshooting → Cannot reach GitHub releases". The script's network-failure message points the user to that doc, not to `pip`.

**Alternative considered:** Bundle a fallback mirror. Rejected: no mirror exists; creating one is out of scope for this change.
**Alternative considered:** Use a CDN mirror (e.g. `objects.githubusercontent.com`) as a fallback when `api.github.com` is down. Rejected: `objects.githubusercontent.com` is rate-limited and the failure modes are not well-documented; the build-from-source path is sufficient for a CLI tool that is also buildable from source.

### D6. Tag override: `-Tag` (PowerShell) and `GEMITERM_TAG` (POSIX), both default to "latest"

The release resolution is a two-step process:
1. If `-Tag` / `GEMITERM_TAG` is set, fetch `https://api.github.com/repos/expert-vision-software/GemiTerm/releases/tags/$Tag` to resolve the tag object (which includes the asset list).
2. Otherwise, fetch `https://api.github.com/repos/expert-vision-software/GemiTerm/releases/latest` (which 302-redirects to the most recent published release).

The tag is interpolated into the download URL: `https://github.com/expert-vision-software/GemiTerm/releases/download/$Tag/GemiTerm.exe` (or `GemiTerm` on POSIX). Defaulting to "latest" means the user does not have to know the current version number — the one-liner in the README is enough.

**Alternative considered:** Use a `LATEST` symlink URL (`/releases/latest/download/GemiTerm.exe`). Rejected: GitHub does not support `latest` in the `download/` path; only the `api/repos/.../releases/latest` endpoint supports it. The two-step is the only correct approach.
**Alternative considered:** Pin a specific version in the script (e.g. `v2.0.0`). Rejected: the script becomes a one-shot for that version; canary installs become a code change. The tag-override parameter is the right shape.

### D7. `PATH` augmentation: check before append, never duplicate, case-insensitive on Windows

Both scripts must:
- Read the current user `PATH` (PowerShell: `[Environment]::GetEnvironmentVariable('Path', 'User')`; POSIX: `echo "$PATH"`).
- Check whether the install dir is **already** present. On Windows, the check is case-insensitive (`$userPath -notlike "*$exeDir*"` after lowercasing both sides, or `Split-Path -Leaf` per segment). On POSIX, the check is case-sensitive (POSIX filesystems are case-sensitive by default).
- Append only if not present. The append uses the platform's path separator (`;` on Windows, `:` on POSIX).
- Update both the **persistent** `PATH` (registry on Windows, `~/.bashrc` snippet on POSIX) and the **current shell's** `PATH` (`$env:Path = "$env:Path;$exeDir"` for the current PowerShell session; `export PATH` after sourcing the snippet on POSIX).

Idempotency is critical: re-running the installer 10 times must produce a `PATH` with exactly one entry for `GemiTerm`. The check-before-append is the entire mechanism — there is no dedup pass.

**Alternative considered:** Always append, then dedup in a second pass. Rejected: a second pass that mutates `PATH` is fragile (it can mangle other entries if the dedup logic has a bug). The check-before-append is one line and is provably correct by inspection.

### D8. Cross-change coordination: `release.yml` must attach both scripts

The `cross-platform-build-and-ci` change owns `.github/workflows/release.yml` and the `release-pipeline` capability. The `release-pipeline` spec at `openspec/changes/cross-platform-build-and-ci/specs/release-pipeline/spec.md:38` already mandates attaching `install.sh` and `install.ps1` as release assets. The install scripts in this change are **inert** until the sibling change ships — without `release.yml` attaching them, there is no asset at the `releases/latest/download/install.ps1` URL that the one-liner in the README points to.

This is a **blocking dependency**: the install scripts in this change should not be merged (or at minimum, should not be advertised in the README) until the sibling change is merged and a `v2.0.0` tag has been pushed to verify the assets are reachable. The `tasks.md` group "8. Cross-change coordination" makes this explicit.

**Alternative considered:** Have this change own `release.yml`. Rejected: that workflow file is the sibling change's scope; this change would either duplicate it or do an end-run around the other proposal. The right move is to coordinate and add a release-attach scenario to the sibling's spec (already done at `release-pipeline/spec.md:42`).
**Alternative considered:** Have this change own only the `install.*` scripts and let the sibling change pick them up via a hardcoded `files:` list. This is the chosen approach; no code change in `release.yml` is needed because the sibling change's spec already lists the files.

### D9. Idempotent `install-browser` verification: glob + `Test-Path` / `test -x`

After `gemiterm install-browser` returns, the installer verifies Chromium is on disk. The v1.4.1 installer uses `Get-ChildItem "$env:LOCALAPPDATA\ms-playwright\chromium-*" -ErrorAction SilentlyContinue` — this is kept for the v2.0.0 installer because the Playwright cache directory layout (`ms-playwright/chromium-<rev>/chrome.exe`) is owned by Playwright and is stable across versions.

On POSIX, the equivalent is `~/.cache/ms-playwright/chromium-*/chrome-linux/chrome` (the `chrome-linux` subdir name is part of the Playwright convention and is stable). The verification step is:
- PowerShell: `Get-ChildItem "$env:LOCALAPPDATA\ms-playwright\chromium-*\chrome.exe" -Recurse | Select-Object -First 1` — exits 0 if any match, else fails with "Chromium installation verification failed".
- POSIX: `find ~/.cache/ms-playwright/chromium-* -name chrome -type f -executable 2>/dev/null | head -n 1` — exits 0 if any match, else fails with the same message.

The `install-browser` step itself is non-deterministic in duration (~100 MB Chromium download on a fresh install, near-instant if Chromium is already present). The installer prints progress (`Downloading GemiTerm…`, `Installing Chromium browser for Playwright…`) so the user is not staring at a silent terminal.

**Alternative considered:** Skip the verification and trust `install-browser`'s exit code. Rejected: `install-browser` can exit 0 on a partial install (e.g. network blip during download) and the user discovers the failure on first `gemiterm auth`. The glob check is cheap (a single directory traversal) and gives a clear "Chromium not found" error.
**Alternative considered:** Bundle Chromium with the binary. Rejected: the v1.4.1 model (download on first install via Playwright) is established and works; bundling doubles the release asset size and breaks the Playwright upgrade path.

## Risks / Trade-offs

- **Risk:** The installer reaches the network (`api.github.com`, `objects.githubusercontent.com`); an offline install is impossible. → **Mitigation:** document the "build from source" fallback in `docs/INSTALL.md`. The fallback uses `git clone` + `bun run build` and produces the same `GemiTerm.exe` / `GemiTerm` artifact. The installer also prints a clear "Cannot reach GitHub releases. Check your network connection or use the 'build from source' instructions in docs/INSTALL.md." message on network failure.

- **Risk:** The installer's `install-browser` step is non-deterministic in duration (~100 MB Chromium download on a fresh install). → **Mitigation:** progress messages (`Downloading GemiTerm…`, `Installing Chromium browser for Playwright…`); non-zero exit on failure. The user can see the install is not hung.

- **Risk:** The installer runs as the invoking user. If the user lacks write to `$env:LOCALAPPDATA` (extremely rare on Windows) or `~/.local/bin` (also rare on Linux; can happen on locked-down corporate distros), the install fails partway. → **Mitigation:** clear error message at the point of failure ("Cannot write to $env:LOCALAPPDATA\GemiTerm. Check your permissions."); document that `LOCALAPPDATA` is per-user and the install path can be overridden via a `-InstallDir` parameter (PowerShell) or `GEMITERM_INSTALL_DIR` env var (POSIX).

- **Risk:** The installer scripts are large for shell scripts (~200 lines each). Hard to read; easy to introduce syntax errors. → **Mitigation:** keep them readable (one step per `function` / `function`-like block, named steps); add a header comment with usage (`# Usage: pwsh -File install.ps1 [-Tag v2.0.0] [-Uninstall] [-InstallDir <path>]`); lint with `pwsh -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('install.ps1', [ref]$null, [ref]$null)"` and `bash -n install.sh` in CI.

- **Risk:** The Windows binary is unsigned. A MITM on `releases/download/...` could substitute a malicious binary. → **Mitigation:** TLS only (`Invoke-WebRequest` / `curl -fSL` enforce HTTPS); pin the release tag (not a floating "latest" URL on the download step — only the API step resolves "latest"). Future: code-signing is in the deferred work list (see `cross-platform-build-and-ci/design.md:41`).

- **Risk:** A v1.4.1 user with a corrupted `%APPDATA%\gemiterm\` may want to start fresh, but the installer never deletes the config dir. → **Mitigation:** `docs/INSTALL.md` documents the manual cleanup path ("`rmdir /s /q %APPDATA%\gemiterm`" on Windows, "`rm -rf ~/.config/gemiterm`" on POSIX). The installer itself is intentionally non-destructive to the config dir.

- **Risk:** The `~/.bashrc` append is bash-only; fish and nushell users won't pick up the `PATH` change. → **Mitigation:** the `docs/INSTALL.md` troubleshooting section calls out "fish/nushell: add `set -gx PATH ~/.local/bin $PATH` to your config.fish / `~/.config/nushell/config.nu`". Out of scope to write per-shell snippets.

- **Risk:** The 5 install-browser-service tests and 3 install-browser-command tests cover the `gemiterm install-browser` subcommand's logic but not its invocation from the installer. → **Mitigation:** the installer's `install-browser` step is a thin wrapper (`& $exePath install-browser`); the existing test coverage is the regression gate. A manual smoke test in `tasks.md` group 7 verifies the full chain locally.

- **Risk:** The WSL install path (`~/.local/bin/gemiterm` on the WSL distro's filesystem) means the Chromium download lives on the WSL filesystem, not the Windows host. This is a behavior difference from v1.4.1 (which downloaded to `%LOCALAPPDATA%` on the Windows host, accessible to both). → **Mitigation:** documented in `docs/INSTALL.md` as "WSL: Chromium is downloaded to the WSL distro, not Windows. The auth flow runs inside WSL." This matches the existing `findWslBrowser` detection in `src/services/install-browser-service.ts:124-141` — Chromium is WSL-local.

- **Trade-off:** Two scripts = two sets of test surface = two lint rules in CI. → **Accepted:** the scripts are independent and the alternative (one cross-platform script) is harder to read and maintain. The shape test (`tests/integration/installer-script-shape.test.ts`) covers both.

- **Trade-off:** The install path on Windows (`$env:LOCALAPPDATA\GemiTerm\`) is **capital G** but the config path (`%APPDATA%\gemiterm\`) is **lowercase**. → **Accepted:** this is the v1.4.1 convention and changing it would break the upgrade-in-place promise. Documented in `docs/INSTALL.md` to avoid user confusion.

## Migration Plan

The change is purely additive — new files at the repo root, one new doc, one README update, one new test. No code in `src/` is touched. The migration is "users running the new install scripts", not "users migrating their data".

**Deploy steps** (all done in this PR):
1. Land `install.ps1` and `install.sh` at the repo root.
2. Land `docs/INSTALL.md` covering both scripts, the upgrade flow, the uninstall flow, the data-paths overview, and the build-from-source fallback.
3. Update `README.md` to point to `docs/INSTALL.md` and add an "Upgrading from v1.4.1" callout.
4. Add `tests/integration/installer-script-shape.test.ts` that runs the PowerShell parser and `bash -n` checks.
5. **Coordinate with the `cross-platform-build-and-ci` change**: confirm that `release.yml` attaches `install.ps1` and `install.sh` to every release. The sibling change's `release-pipeline` spec at `openspec/changes/cross-platform-build-and-ci/specs/release-pipeline/spec.md:38` already mandates this. Verify by reading the spec before merging.
6. Push a `v2.0.0-rc.1` tag to verify the release pipeline attaches both scripts. Open the GitHub Release and confirm `install.ps1` and `install.sh` are downloadable from `https://github.com/expert-vision-software/GemiTerm/releases/download/v2.0.0-rc.1/`. Delete the tag and the draft release after verification.
7. Push `v2.0.0` to ship.

**v1.4.1 → v2.0.0 user data migration:**
- Windows: zero action required by the user. The installer overwrites `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe` in place; `%APPDATA%\gemiterm\` is untouched. The user's profiles, cookies, and `.default` marker are preserved automatically.
- Linux/WSL: there is no v1.4.1 install path on Linux (the v1.4.1 Python binary was Windows-only). No user-data migration needed.

**Rollback strategy:**
- The install scripts are inert until a `v*` tag is pushed and the release is published. Rolling back this change after merge but before tag push: revert the commit.
- Rolling back after a `v2.0.0` tag is published: the maintainer can re-tag with `v2.0.1` after fixing the script, or delete the GitHub Release. The v2.0.0 binary already on a user's machine keeps working (the installer's only job is to drop the binary; the binary itself has its own update-via-`gemiterm update` path if added later, or the user re-runs the installer).
- The `install-browser` step's regression gate is the 5+3 existing tests. If a future change to those files breaks the install flow, the change to those files is the one to revert, not the installer.

## Open Questions

- **Q1:** Should the PowerShell installer accept `-InstallDir <path>` to override the default `$env:LOCALAPPDATA\GemiTerm` location (e.g. for users who want a portable install on a USB drive)? The proposal's wording says no (hard-coded path), but a parameter is a small addition. **Decision:** add a `-InstallDir` parameter on PowerShell and a `GEMITERM_INSTALL_DIR` env var on POSIX, both defaulting to the platform standard. This handles the rare user who needs to override.

- **Q2:** Should `install.sh` create the `~/.local/bin` directory if it doesn't exist (XDG conventions say it should exist on first use, but Debian and Ubuntu do not create it by default)? **Decision:** yes, `mkdir -p` is idempotent and the install path is meaningless without it. The install prints a message if the dir was created.

- **Q3:** Should the installer verify a checksum of the downloaded binary? The v1.4.1 installer did not. **Decision:** not in this change. SHA256 verification is a follow-up that requires a `SHA256SUMS` file in the release (which the sibling `cross-platform-build-and-ci` change would also need to attach). Documented as a future improvement.

- **Q4:** Should `install.sh` also `chmod +x` the binary explicitly, or trust the `mv` from the temp file to preserve the executable bit? **Decision:** explicit `chmod +x`. The temp-file write may not preserve the bit (depends on the `umask`), and the user-facing command is `gemiterm`, not `./gemiterm` — a non-executable binary is a confusing failure.

- **Q5:** Should the uninstall flow also remove the `~/.config/gemiterm/env.sh` snippet, or leave it for the user to clean up? **Decision:** remove it. The env snippet is owned by the install (not by the user), and leaving it on uninstall is a half-state that confuses re-installs. The config dir (`profiles/`, `.default`) is **not** removed.

- **Q6:** Should the PowerShell uninstall also revoke the persistent `PATH` change in the Windows registry (`HKCU\Environment`), or only the current session's `PATH`? **Decision:** revoke the persistent change via `[Environment]::SetEnvironmentVariable('Path', $newPath, 'User')` — this is the registry write. The v1.4.1 uninstall did this and the v2.0.0 uninstall must match.

- **Q7:** What is the minimum supported Windows version? The v1.4.1 installer required Windows PowerShell 5.1 (shipped with Windows 7+); the v2.0.0 installer uses PowerShell Core 7+ (which is on GitHub Actions runners but not pre-installed on most Windows desktops). **Decision:** document "PowerShell 7 or later" in `docs/INSTALL.md` and link to the install instructions (`winget install Microsoft.PowerShell`). The one-liner `irm ... | iex` works on PowerShell 5.1 for the `Install-Module`-style of one-liner, but the v2.0.0 script uses Core-only syntax (`Split-Path -Parent $PSCommandPath`). A user with only Windows PowerShell 5.1 will need to upgrade.

- **Q8:** Should the README mention the `v2.0.0-rc.1` tag-override flag, or keep it as "advanced" in `docs/INSTALL.md`? **Decision:** keep it in `docs/INSTALL.md` only. The README's one-liner is the 95% path; canary installs are a 5% path and should not clutter the quick-start.

- **Q9:** Should the install script also support installing from a local file (e.g. `pwsh -File install.ps1 -FromFile /path/to/GemiTerm.exe`) for testing or air-gapped installs? **Decision:** not in this change. The "build from source" path in `docs/INSTALL.md` covers the air-gapped case.
