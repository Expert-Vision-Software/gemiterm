# Auth-regression gate check — PowerShell parity of scripts/check-auth-gate.sh
# See that script for the full contract (GATE_BASE override, allowlist, opt-out).

$ErrorActionPreference = "Stop"

if ($env:SKIP_AUTH_REGRESSION_GATE -eq "1") {
    Write-Host "Auth regression gate SKIPPED via SKIP_AUTH_REGRESSION_GATE=1" -ForegroundColor Yellow
    Write-Host "Opt-outs are audited: state the reason in the PR body / commit message."
    exit 0
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

$Allowlist = @()
if (Test-Path "scripts/auth-gate-allowlist") {
    $Allowlist = Get-Content "scripts/auth-gate-allowlist" | Where-Object { $_ -and -not $_.StartsWith("#") }
}

$BaseCommit = $env:GATE_BASE
if (-not $BaseCommit) { $BaseCommit = git merge-base "@{u}" HEAD 2>$null }
if (-not $BaseCommit) { $BaseCommit = "HEAD~1" }

git rev-parse --verify -q "$BaseCommit^{commit}" *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Auth regression gate: cannot resolve base commit '$BaseCommit'. Set GATE_BASE=<sha>." -ForegroundColor Red
    exit 1
}

$PathSpecs = @(
    'src/auth/**', 'src/infrastructure/storage.ts', 'src/infrastructure/io.ts',
    'src/services/playwright-cli-driver.ts', 'src/services/gemini-client-wrapper.ts',
    'src/services/profile-lifecycle.ts', 'docs/auth-cookie-lifecycle.md'
)

$ChangedAuthFiles = @(git diff --name-only "$BaseCommit" HEAD -- $PathSpecs 2>$null | Where-Object { $_ })
$ChangedTestFiles = @(git diff --name-only "$BaseCommit" HEAD -- 'tests/auth-regression/**' 2>$null | Where-Object { $_ })

$ContentRegex = 'cookie|PSID|storage_state|CookieSession|silentRefresh|rotate'
$OtherAuthChanges = @()
foreach ($f in @(git diff --name-only "$BaseCommit" HEAD 2>$null | Where-Object { $_ })) {
    if (-not (Test-Path $f -PathType Leaf)) { continue }
    if ($f -match '^(src/auth/|tests/|openspec/|docs/archive/)' -or $f -like '*.md') { continue }
    if ($Allowlist -contains $f) { continue }
    if (Select-String -Path $f -Pattern $ContentRegex -Quiet -CaseSensitive:$false) {
        $OtherAuthChanges += $f
    }
}

if ($ChangedAuthFiles.Count -eq 0 -and $OtherAuthChanges.Count -eq 0) {
    Write-Host "Auth regression gate: PASS (no auth-sensitive changes)" -ForegroundColor Green
    exit 0
}

if ($ChangedTestFiles.Count -gt 0) {
    Write-Host "Auth regression gate: PASS" -ForegroundColor Green
    Write-Host "Auth-sensitive changes covered by tests/auth-regression/ updates."
    exit 0
}

Write-Host "Auth regression gate: FAIL" -ForegroundColor Red
Write-Host "Auth-sensitive paths changed without any tests/auth-regression/ change:"
$ChangedAuthFiles + $OtherAuthChanges | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Fix: add/update tests under tests/auth-regression/ in the same change."
Write-Host "Opt-out: SKIP_AUTH_REGRESSION_GATE=1 with a stated reason (audited)."
Write-Host "Path list: AUTH_SENSITIVE_PATHS; allowlist: scripts/auth-gate-allowlist."
exit 1