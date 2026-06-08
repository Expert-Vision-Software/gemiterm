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

.PARAMETER InstallDir
    Override the default install directory (default: $env:LOCALAPPDATA\GemiTerm).

.EXAMPLE
    irm https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.ps1 | iex
    pwsh -File install.ps1 -Tag v2.0.0-rc.1
    pwsh -File install.ps1 -Uninstall
#>
param(
    [string]$Tag = 'latest',
    [switch]$Uninstall,
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
        Remove-Item $ExePath -Force
        Write-Host "  Removed $ExePath"
    }

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath -and $userPath.ToLower().Contains($InstallDir.ToLower())) {
        $newPath = ($userPath -split ';' | Where-Object { $_ -and $_.ToLower() -ne $InstallDir.ToLower() }) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        Write-Host "  Removed $InstallDir from PATH"
    }

    $env:Path = ($env:Path -split ';' | Where-Object { $_ -and $_.ToLower() -ne $InstallDir.ToLower() }) -join ';'

    Write-Host "GemiTerm uninstalled successfully."
    exit 0
}

# --- Upgrade detection (task 2.3) ---
if (Test-Path $ExePath) {
    Write-Host "Detected existing install at $ExePath; upgrading in place."
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

$asset = $release.assets | Where-Object { $_.name -eq 'GemiTerm.exe' }
if (-not $asset) {
    Write-Host "No GemiTerm.exe asset found in release."
    exit 1
}

$version = $release.tag_name

# --- Download (task 2.5) ---
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$tempPath = Join-Path $InstallDir 'GemiTerm.exe.new'
try {
    Write-Host "Downloading GemiTerm $version..."
    Invoke-WebRequest $asset.browser_download_url -OutFile $tempPath
    Move-Item -Force $tempPath $ExePath
} catch {
    if (Test-Path $tempPath) { Remove-Item $tempPath -Force -ErrorAction SilentlyContinue }
    Write-Host "Download failed: $_"
    exit 1
}

# --- Bootstrap Bun if needed (task 9.1 + 9.3) ---
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Bun..."
    try {
        irm https://bun.sh/install.ps1 | iex
    } catch {
        Write-Host "Bun installation failed. Install Bun manually from https://bun.sh and re-run this installer."
        exit 1
    }
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
        Write-Host "Bun installation failed. Install Bun manually from https://bun.sh and re-run this installer."
        exit 1
    }
}

# --- Install Chromium (task 2.6) ---
Write-Host "Installing Chromium browser for Playwright..."
try {
    & bunx @playwright/cli install chromium
    if ($LASTEXITCODE -ne 0) {
        throw "bunx exited with code $LASTEXITCODE"
    }
} catch {
    Write-Host "Chromium installation failed. Re-run the installer after fixing the issue, or run 'bunx @playwright/cli install chromium' manually."
    exit 1
}

# --- Verify Chromium (task 2.7) ---
$chromeExe = Get-ChildItem "$env:LOCALAPPDATA\ms-playwright\chromium-*\chrome.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($chromeExe) {
    Write-Host "Chromium verified at $($chromeExe.FullName)"
} else {
    Write-Host "Chromium installation verification failed. Re-run the installer after fixing the network, or run 'bunx @playwright/cli install chromium' manually."
    exit 1
}

# --- PATH augmentation (task 2.8) ---
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -and -not $userPath.ToLower().Contains($InstallDir.ToLower())) {
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$InstallDir", 'User')
    $env:Path = "$env:Path;$InstallDir"
    Write-Host "Added $InstallDir to PATH"
}

# --- Success (task 2.9) ---
Write-Host "GemiTerm $version installed to $ExePath. Run 'gemiterm status' to verify, then 'gemiterm auth' to authenticate."
