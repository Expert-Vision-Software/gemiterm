# Installation Guide

The installer scripts are attached to every GitHub release by the `release.yml` workflow. If you see a 404 on the one-liner URL, the release pipeline (owned by the `cross-platform-build-and-ci` change) may not have attached the scripts; check the GitHub release page directly.

## Install

**Windows** (PowerShell 7+):

```powershell
irm https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.ps1 | iex
```

**Linux / WSL**:

```bash
curl -fsSL https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.sh | bash
```

> **Recommended install via package manager.** If you have `bun` or `npm` on PATH, the installer will detect it and prompt: "It is recommended to install via bun or npm package manager. Are you sure you want to continue with binary install?" Answer `y` to proceed with the binary drop, or install via:
> - `bun i -g gemiterm`
> - `npm i -g gemiterm`
>
> The prompt is suppressed when stdin is not a TTY (e.g. the `curl | bash` one-liner flow), so unattended installs proceed.

## Upgrade from v1.4.1

Your profiles, cookies, and default-profile marker are preserved. The installer replaces the binary in place; it does **NOT** touch `%APPDATA%\gemiterm\` (Windows) or `~/gemiterm/` (POSIX). This is verified by the path-resolution logic in `src/infrastructure/path-utils.ts` — the v2.0.0 binary reads from the same config directory that v1.4.1 wrote to.

On Windows, the v1.4.1 Python config lived at `%USERPROFILE%\.config\gemiterm\` (Python's `Path.home() / ".config/gemiterm"` has no Windows branch). When the installer detects a v1.4.1 config at that path and no v2.0.0 config at `%APPDATA%\gemiterm\`, it copies the tree forward automatically. The v1.4.1 directory is left in place as a safety net — you can delete it manually after verifying the migration.

On POSIX, the v1.4.1 Python config lived at `~/.config/gemiterm/`. v2.0.0 reads from `~/gemiterm/`. The installer performs the same one-time copy-forward when it detects the old path.

If you have the Python v1.4.1 version installed via `pip`, the installer will detect it and ask you to run `pip uninstall gemiterm` first. Your config data is safe and will be preserved through the uninstall/reinstall cycle.

## Uninstall

**Windows**:

```powershell
pwsh -File install.ps1 -Uninstall
```

**Linux / WSL**:

```bash
bash install.sh --uninstall
```

Uninstall removes the binary and PATH entry but **preserves** your config directory (profiles, cookies, default-profile marker). Re-installing afterward will find the same profiles as before.

## Data Paths

| Path | Windows | Linux / WSL |
|------|---------|-------------|
| **Binary** | `$env:LOCALAPPDATA\GemiTerm\GemiTerm.exe` | `~/.local/bin/gemiterm` |
| **Config** | `%APPDATA%\gemiterm\` | `~/gemiterm/` |
| **Chromium cache** | `$env:LOCALAPPDATA\ms-playwright\` | `~/.cache/ms-playwright/` |

> **Note:** On Windows, the install directory is **capital G** (`GemiTerm`) while the config directory is **lowercase** (`gemiterm`). This matches the v1.4.1 convention and is intentional.

## Tag Override (Canary / RC Installs)

To install a specific release instead of the latest:

**Windows**:

```powershell
pwsh -File install.ps1 -Tag v2.0.0-rc.1
```

**Linux / WSL**:

```bash
GEMITERM_TAG=v2.0.0-rc.1 bash install.sh
```

## Custom Install Directory

**Windows**:

```powershell
pwsh -File install.ps1 -InstallDir D:\Tools\GemiTerm
```

**Linux / WSL**:

```bash
GEMITERM_INSTALL_DIR=~/.local/bin bash install.sh
```

## Troubleshooting

### PATH did not refresh in current shell

After installing, if `gemiterm` is not found:

**Windows** — reload your PATH in the current PowerShell session:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User')
gemiterm --version
```

Or open a new terminal.

**Linux / WSL** — source the env snippet:

```bash
source ~/gemiterm/env.sh
gemiterm --version
```

Or open a new terminal.

### Chromium installation fails

The installer runs `bunx @playwright/cli install chromium` as part of the install flow. If it fails:

1. Check your network connection (Chromium is ~100 MB).
2. Re-run the installer.
3. Or manually run: `bunx @playwright/cli install chromium`

### Cannot reach GitHub releases

If the installer cannot contact `api.github.com`:

1. Check your network connection.
2. Use the **Build from source** instructions below.

### Bun not installed

The installer automatically bootstraps [Bun](https://bun.sh) if it is not found. If the bootstrap fails:

1. Install Bun manually from [bun.sh](https://bun.sh).
2. Re-run the installer.

### fish / nushell users

The POSIX installer appends a `source` line to `~/.bashrc` and `~/.zshrc`. For other shells, add the PATH manually:

**fish** (`~/.config/fish/config.fish`):

```fish
set -gx PATH ~/.local/bin $PATH
```

**nushell** (`~/.config/nushell/config.nu`):

```nu
$env.PATH = ($env.PATH | prepend ~/.local/bin)
```

## Build from Source

Requires [Bun](https://bun.sh) 1.3.13 or later.

```bash
git clone https://github.com/expert-vision-software/GemiTerm.git
cd GemiTerm
bun install
bun run build
```

The resulting binary is at `dist/gemiterm` (Linux/macOS) or `dist/gemiterm.exe` (Windows). Move it to the install path:

**Linux / WSL**:

```bash
mkdir -p ~/.local/bin
mv dist/gemiterm ~/.local/bin/gemiterm
chmod +x ~/.local/bin/gemiterm
```

**Windows**:

```powershell
mkdir $env:LOCALAPPDATA\GemiTerm
Move-Item dist\gemiterm.exe $env:LOCALAPPDATA\GemiTerm\GemiTerm.exe
```

Then install Chromium:

```bash
bunx @playwright/cli install chromium
```
