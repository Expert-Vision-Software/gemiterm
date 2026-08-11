# phantom-regression-test.ps1
# Instant test for the dormancy bug — no 6-hour wait.
# Usage:
#   pwsh tests\phantom-regression-test.ps1                     # full suite
#   pwsh tests\phantom-regression-test.ps1 <profile-dir>       # single profile
#   pwsh tests\phantom-regression-test.ps1 <dir> -n <name>     # custom profile name
#   pwsh tests\phantom-regression-test.ps1 --simulate <dir>     # corrupt PSIDTS to simulate phantom
#   pwsh tests\phantom-regression-test.ps1 --restore <dir>      # restore backup
#   pwsh tests\phantom-regression-test.ps1 --keep              # don't clean up

[CmdletBinding()]
param(
    [string]$ProfileDir,
    [string]$ProfileName = "dhb-zeek",
    [switch]$Keep,
    [switch]$Simulate,
    [switch]$Restore
)

$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot | Split-Path -Parent

$DHB_PROFILE     = "c:\temp\gemiterm\profiles\dhb-zeek"
$LOCAL_PROFILE   = "$env:APPDATA\gemiterm\profiles\dhb-zeek-readonly"
$STORAGE_FILE    = "storage_state.json"

$pass = 0
$fail = 0

function SetupProfile($sourceDir, $testDir, $profileName) {
    $profileDir = Join-Path $testDir "profiles\$profileName"
    New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
    Copy-Item (Join-Path $sourceDir $STORAGE_FILE) $profileDir -Force
    $f = Get-Item (Join-Path $profileDir $STORAGE_FILE)
    if ($f.IsReadOnly) { $f.IsReadOnly = $false }
    Set-Content -Path (Join-Path $testDir "profiles\.default") -Value $profileName -NoNewline
}

function Run-Gemiterm {
    param([string[]]$GeminiArgs)
    $env:GEMITERM_CONFIG_DIR = $TempDir
    $env:GEMITERM_SKIP_ROTATE_COOKIES = "true"
    Set-Location $RepoRoot
    $result = & bun src/cli/index.ts @GeminiArgs 2>&1
    Remove-Item Env:\GEMITERM_CONFIG_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:\GEMITERM_SKIP_ROTATE_COOKIES -ErrorAction SilentlyContinue
    return (($result -join "`n") -replace '\x1b\[[0-9;]*m', '').Trim()
}

function Assert($label, $output, $pattern, $desc) {
    if ($output -match $pattern) {
        Write-Host "  PASS — $desc" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "  FAIL — expected: $desc" -ForegroundColor Red
        Write-Host "  Got:" -ForegroundColor Red
        ($output -split "`n" | Select-Object -First 3) | ForEach-Object { Write-Host "    $_" }
        $script:fail++
    }
}

# ═══ RESTORE MODE ══════════════════════════════════════════
if ($Restore) {
    if (-not $ProfileDir) { Write-Host "Need --restore <profile-dir>" -ForegroundColor Red; exit 1 }
    $backupFile = Join-Path $ProfileDir "$STORAGE_FILE.backup"
    if (-not (Test-Path $backupFile)) {
        Write-Host "No backup found at $backupFile" -ForegroundColor Red
        exit 1
    }
    $target = Join-Path $ProfileDir $STORAGE_FILE
    Copy-Item $backupFile $target -Force
    Write-Host "Restored $target from backup" -ForegroundColor Green
    exit 0
}

# ═══ SIMULATE MODE ══════════════════════════════════════════
if ($Simulate) {
    if (-not $ProfileDir) { Write-Host "Need --simulate <profile-dir>" -ForegroundColor Red; exit 1 }
    $target = Join-Path $ProfileDir $STORAGE_FILE
    if (-not (Test-Path $target)) { Write-Host "No storage_state.json at $target" -ForegroundColor Red; exit 1 }

    $backupFile = Join-Path $ProfileDir "$STORAGE_FILE.backup"
    Copy-Item $target $backupFile -Force
    Write-Host "Backup saved: $backupFile" -ForegroundColor Green

    $j = Get-Content $target -Raw | ConvertFrom-Json
    $scrambled = 0
    foreach ($c in $j.cookies) {
        if ($c.name -eq "__Secure-1PSIDTS") {
            $c.value = "sidts-Cj0B-SIMULATED-PHANTOM-FOR-TEST-ONLY-$([Guid]::NewGuid().ToString().Substring(0,8))"
            $scrambled++
        }
    }
    $j | ConvertTo-Json -Depth 10 | Set-Content $target -NoNewline
    Write-Host "Scrambled $scrambled PSIDTS cookie(s). Profile is now simulated-phantom." -ForegroundColor Yellow
    Write-Host "Run: pwsh tests\phantom-regression-test.ps1 <dir> --restore  to undo." -ForegroundColor Yellow
    exit 0
}

# ═══ SINGLE-PROFILE MODE ═══════════════════════════════════
if ($ProfileDir) {
    Write-Host "=== Profile Test: $ProfileDir ===" -ForegroundColor Cyan
    $TempDir = Join-Path $env:TEMP "gemiterm-ptest-$([Guid]::NewGuid().ToString().Substring(0,6))"
    SetupProfile $ProfileDir $TempDir $ProfileName | Out-Null
    $out = Run-Gemiterm "list" "-p" $ProfileName

    $silentPhantom = $out -match "No conversations found" -and $out -notmatch "(?:re-auth|login|expired|no longer valid|AuthenticationError)"
    $hasChats = $out -match "Total: (\d+) conversations" -and [int]$Matches[1] -gt 0
    $hasError = $out -match "(?:re-auth|login|expired|no longer valid|AuthenticationError)"

    if ($hasChats) {
        Write-Host "PASS — $($Matches[1]) conversations (session is functional)" -ForegroundColor Green
    } elseif ($hasError) {
        Write-Host "PASS — phantom detected, re-auth directive shown" -ForegroundColor Green
    } elseif ($silentPhantom) {
        Write-Host "FAIL — silent phantom: 'No conversations found' without detection" -ForegroundColor Red
    } else {
        Write-Host "UNKNOWN — unexpected output:" -ForegroundColor Yellow
        $out -split "`n" | Select-Object -First 5
    }
    if (-not $Keep) { Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue }
    exit 0
}

# ═══ FULL SUITE ═════════════════════════════════════════════
Write-Host "=== Phantom Regression Test ===" -ForegroundColor Cyan
Write-Host ""

# Test 1 — DHBGAMING2 working profile
Write-Host "[1] Working profile (DHBGAMING2, 13d old)" -ForegroundColor Yellow
$TempDir = Join-Path $env:TEMP "gemiterm-t1-$([Guid]::NewGuid().ToString().Substring(0,6))"
SetupProfile $DHB_PROFILE $TempDir "dhb-zeek" | Out-Null
$out = Run-Gemiterm "list"
Assert "t1" $out "Total: (\d+) conversations" "returns conversations"
if (-not $Keep) { Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue }

# Test 2 — phantom profile
Write-Host "[2] Phantom profile (must detect, NOT silent 0)" -ForegroundColor Yellow
$TempDir = Join-Path $env:TEMP "gemiterm-t2-$([Guid]::NewGuid().ToString().Substring(0,6))"
SetupProfile $LOCAL_PROFILE $TempDir "dhb-zeek" | Out-Null
$out = Run-Gemiterm "list"
if ($out -match "Total: (\d+) conversations" -and [int]$Matches[1] -gt 0) {
    Write-Host "  PASS — recovered phantom ($($Matches[1]) chats)" -ForegroundColor Green
    $pass++
} elseif ($out -match "(?:re-auth|login|expired|no longer valid|AuthenticationError)") {
    Write-Host "  PASS — detected phantom, directed to re-auth" -ForegroundColor Green
    $pass++
} elseif ($out -match "No conversations found") {
    Write-Host "  FAIL — silent phantom: 'No conversations found'" -ForegroundColor Red
    $fail++
} else {
    Write-Host "  WARN — unexpected:" -ForegroundColor Yellow
    ($out -split "`n" | Select-Object -First 3)
}
if (-not $Keep) { Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue }

# Test 3 — missing PSID
Write-Host "[3] Missing PSID (must error clearly)" -ForegroundColor Yellow
$TempDir = Join-Path $env:TEMP "gemiterm-t3-$([Guid]::NewGuid().ToString().Substring(0,6))"
SetupProfile $DHB_PROFILE $TempDir "dhb-zeek" | Out-Null
$sp = Join-Path $TempDir "profiles\dhb-zeek\storage_state.json"
$j = Get-Content $sp -Raw | ConvertFrom-Json
$j.cookies = @($j.cookies | Where-Object { $_.name -ne "__Secure-1PSID" })
$j | ConvertTo-Json -Depth 10 | Set-Content $sp -NoNewline
$out = Run-Gemiterm "list"
Assert "t3" $out "(?:re-auth|login|AuthenticationError|expired|no longer valid|No valid session)" "clear re-auth directive"
if (-not $Keep) { Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "=== $pass pass / $fail fail ===" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
exit $fail
