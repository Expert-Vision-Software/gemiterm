#Requires -Version 7.0
<#
.SYNOPSIS
    GemiTerm v2.0.0 installer for Windows.

.DESCRIPTION
    v1.4.1 → v2.0.0 upgrades replace the binary in place; the config dir at
    %APPDATA%\gemiterm\ (Windows) is NEVER deleted by this installer.

.PARAMETER Tag
    GitHub release tag to install (default: "latest").

.PARAMETER Uninstall
    Remove GemiTerm binary and PATH entry. Preserves config dir at
    %APPDATA%\gemiterm\.

.PARAMETER WhatIf
    Show what the installer would do without making any changes.

.PARAMETER InstallDir
    Override the default install directory (default: $env:LOCALAPPDATA\GemiTerm).

.EXAMPLE
    irm https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.ps1 | iex
    pwsh -File install.ps1 -Tag v2.0.0-rc.1
    pwsh -File install.ps1 -Uninstall
    pwsh -File install.ps1 -WhatIf
#>
param(
    [string]$Tag = 'latest',
    [switch]$Uninstall,
    [switch]$WhatIf,
    [string]$InstallDir = "$env:LOCALAPPDATA\GemiTerm"
)

$ErrorActionPreference = 'Stop'

$Repo = 'expert-vision-software/GemiTerm'
$ExePath = Join-Path $InstallDir 'GemiTerm.exe'

# --- Detect Python v1.4.1 (task 8.1) ---
if (Get-Command pip -ErrorAction SilentlyContinue) {
    try {
        $null = pip show gemiterm 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "WARNING: Python v1.4.1 detected. Your config data at %APPDATA%\gemiterm\ is safe and will be preserved. Please run 'pip uninstall gemiterm' before re-running this installer to complete the v2.0.0 installation."
            exit 1
        }
    } catch {
        # pip show returned non-zero — gemiterm not installed via pip
    }
}

# --- Uninstall (task 2.2) ---
if ($Uninstall) {
    Write-Host "Removing GemiTerm..."

    if (Test-Path $ExePath) {
        if ($WhatIf) {
            Write-Host "[WhatIf] Would delete $ExePath"
        } else {
            Remove-Item $ExePath -Force
            Write-Host "  Removed $ExePath"
        }
    } else {
        Write-Host "  $ExePath not found (already removed)"
    }

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath -and $userPath.ToLower().Contains($InstallDir.ToLower())) {
        $newPath = ($userPath -split ';' | Where-Object { $_ -and $_.ToLower() -ne $InstallDir.ToLower() }) -join ';'
        if ($WhatIf) {
            Write-Host "[WhatIf] Would remove $InstallDir from user PATH"
        } else {
            [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
            Write-Host "  Removed $InstallDir from PATH"
        }
    }

    if ($WhatIf) {
        Write-Host "[WhatIf] Would update current session PATH"
    } else {
        $env:Path = ($env:Path -split ';' | Where-Object { $_ -and $_.ToLower() -ne $InstallDir.ToLower() }) -join ';'
    }

    Write-Host "GemiTerm uninstall review complete. No changes were made." -ForegroundColor Cyan
    exit 0
}

# --- Upgrade detection (task 2.3) ---
if (Test-Path $ExePath) {
    Write-Host "Detected existing install at $ExePath; upgrading in place."
}

# --- v1.4.1 → v2.0.0 config migration (task 11.1) ---
# v1.4.1 wrote config to $env:USERPROFILE\.config\gemiterm\ on Windows
# (Python config.py:14 has no Windows branch; Path.home() returns the
# user profile and the literal ".config/gemiterm" is appended). v2.0.0
# reads from $env:APPDATA\gemiterm\. If the old path exists and the new
# one does not, copy the tree forward. The v1.4.1 directory is left in
# place as a safety net; the user can delete it manually.
$V14ConfigDir = Join-Path $env:USERPROFILE '.config\gemiterm'
$V2ConfigDir = Join-Path $env:APPDATA 'gemiterm'
if ((Test-Path $V14ConfigDir) -and -not (Test-Path $V2ConfigDir)) {
    Write-Host "Detected v1.4.1 config at $V14ConfigDir; migrating to $V2ConfigDir"
    if ($WhatIf) {
        Write-Host "[WhatIf] Would create directory $V2ConfigDir"
        Write-Host "[WhatIf] Would copy $V14ConfigDir\* to $V2ConfigDir"
    } else {
        New-Item -ItemType Directory -Path $V2ConfigDir -Force | Out-Null
        Copy-Item -Recurse -Force -Path (Join-Path $V14ConfigDir '*') -Destination $V2ConfigDir
        Write-Host "v1.4.1 config copied to $V2ConfigDir. The original at $V14ConfigDir is left in place as a backup."
    }
}

# Determine package-manager executable (prefer bunx over npx)
$PackageManagerX = if (Get-Command bun -ErrorAction SilentlyContinue) { 'bunx' } elseif (Get-Command npm -ErrorAction SilentlyContinue) { 'npx' } else { 'bunx' }

# --- Package-manager prompt (task 11.2) ---
# If bun or npm is on PATH, recommend installing via the package manager
# (npm: `npm i -g gemiterm`; bun: `bun i -g gemiterm`) instead of this
# binary drop. The prompt is skipped when stdin is not a TTY (e.g. the
# `irm | iex` one-liner flow runs unattended and must not block).
if (((Get-Command bun -ErrorAction SilentlyContinue) -or (Get-Command npm -ErrorAction SilentlyContinue)) -and [Console]::IsInputRedirected -eq $false) {
    Write-Host ""
    Write-Host "It is recommended to install via bun or npm package manager."
    Write-Host "Are you sure you want to continue with binary install? [y/N]"
    $reply = Read-Host
    if ($reply -notmatch '^[yY]([eE][sS])?$') {
        $pm = if (Get-Command bun -ErrorAction SilentlyContinue) { 'bun i -g gemiterm' } else { 'npm i -g gemiterm' }
        Write-Host "Aborted. Install via: $pm"
        exit 0
    }
}

# --- Resolve release (task 2.4 + 2.10) ---
$ApiUrl = if ($Tag -eq 'latest') {
    "https://api.github.com/repos/$Repo/releases/latest"
} else {
    "https://api.github.com/repos/$Repo/releases/tags/$Tag"
}

$release = $null
try {
    $release = Invoke-RestMethod $ApiUrl -TimeoutSec 30
} catch {
    Write-Host "Cannot reach GitHub releases. Check your network connection or use the 'build from source' instructions in docs/INSTALL.md."
    exit 1
}

if (-not $release -or -not $release.assets) {
    Write-Host "No releases found."
    Write-Host "Build from source: git clone https://github.com/$Repo.git && cd GemiTerm && bun install && bun run build"
    exit 1
}

$asset = $release.assets | Where-Object { $_.name -eq 'gemiterm.exe' }
if (-not $asset) {
    Write-Host "No gemiterm.exe asset found in release."
    exit 1
}

$version = $release.tag_name

# --- Download (task 2.5) ---
if (-not (Test-Path $InstallDir)) {
    if ($WhatIf) {
        Write-Host "[WhatIf] Would create directory $InstallDir"
    } else {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
}

$tempPath = Join-Path $InstallDir 'GemiTerm.exe.new'
if ($WhatIf) {
    Write-Host "[WhatIf] Would download GemiTerm $version from $($asset.browser_download_url) to $tempPath"
    Write-Host "[WhatIf] Would move $tempPath to $ExePath"
} else {
    try {
        Write-Host "Downloading GemiTerm $version..."
        Invoke-WebRequest $asset.browser_download_url -OutFile $tempPath
        Move-Item -Force $tempPath $ExePath
    } catch {
        if (Test-Path $tempPath) { Remove-Item $tempPath -Force -ErrorAction SilentlyContinue }
        Write-Host "Download failed: $_"
        exit 1
    }
}

# --- Bootstrap package manager if needed (task 9.1 + 9.3) ---
if ($PackageManagerX -eq 'bunx' -and -not (Get-Command bun -ErrorAction SilentlyContinue)) {
    if ($WhatIf) {
        Write-Host "[WhatIf] Would install Bun from https://bun.sh/install.ps1"
    } else {
        Write-Host "Installing Bun..."
        try {
            irm https://bun.sh/install.ps1 | iex
        } catch {
            if (Get-Command npm -ErrorAction SilentlyContinue) {
                Write-Host "Bun installation failed, falling back to npx."
                $PackageManagerX = 'npx'
            } else {
                Write-Host "Bun installation failed and npm is not available. Install Bun from https://bun.sh or npm from https://nodejs.org and re-run this installer."
                exit 1
            }
        }
        if ($PackageManagerX -eq 'bunx' -and -not (Get-Command bun -ErrorAction SilentlyContinue)) {
            if (Get-Command npm -ErrorAction SilentlyContinue) {
                Write-Host "Bun installation failed, falling back to npx."
                $PackageManagerX = 'npx'
            } else {
                Write-Host "Bun installation failed. Install Bun manually from https://bun.sh and re-run this installer."
                exit 1
            }
        }
    }
}

# --- Install Chromium (task 2.6) ---
if ($WhatIf) {
    Write-Host "[WhatIf] Would run: $PackageManagerX @playwright/cli install chromium"
} else {
    Write-Host "Installing Chromium browser for Playwright..."
    try {
        & $PackageManagerX @playwright/cli install chromium
        if ($LASTEXITCODE -ne 0) {
            throw "$PackageManagerX exited with code $LASTEXITCODE"
        }
    } catch {
        Write-Host "Chromium installation failed. Re-run the installer after fixing the issue, or run '$PackageManagerX @playwright/cli install chromium' manually."
        exit 1
    }
}

# --- Verify Chromium (task 2.7) ---
$chromeExe = Get-ChildItem "$env:LOCALAPPDATA\ms-playwright\chromium-*\chrome.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($chromeExe) {
    Write-Host "Chromium verified at $($chromeExe.FullName)"
} else {
    Write-Host "Chromium installation verification failed. Re-run the installer after fixing the network, or run '$PackageManagerX @playwright/cli install chromium' manually."
    exit 1
}

# --- PATH augmentation (task 2.8) ---
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -and -not $userPath.ToLower().Contains($InstallDir.ToLower())) {
    if ($WhatIf) {
        Write-Host "[WhatIf] Would add $InstallDir to user PATH"
    } else {
        [Environment]::SetEnvironmentVariable('Path', "$userPath;$InstallDir", 'User')
        $env:Path = "$env:Path;$InstallDir"
        Write-Host "Added $InstallDir to PATH"
    }
}

# --- Success (task 2.9) ---
if ($WhatIf) {
    Write-Host ""
    Write-Host "WhatIf review complete. No changes were made." -ForegroundColor Cyan
    Write-Host "GemiTerm $version would be installed to $ExePath using $($PackageManagerX).Chromium."
    Write-Host "Run without -WhatIf to apply."
} else {
    Write-Host "GemiTerm $version installed to $ExePath. Run 'gemiterm status' to verify, then 'gemiterm auth' to authenticate."
}
