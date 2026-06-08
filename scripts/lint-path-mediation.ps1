# scripts/lint-path-mediation.ps1
#
# PowerShell Core port of scripts/lint-path-mediation.sh.
# Enforce the path-and-file mediation rule: no file in src/ outside the
# allowed exemptions may import from node:fs, node:path, or node:os.
#
# Allowed exemptions:
#   - src/infrastructure/path-utils.ts (canonical home)
#   - src/services/install-browser-service.ts (WSL mount parser)
#
# Exit 0 when the rule is satisfied, non-zero with a clear message otherwise.
# This script is called by the CI test.yml workflow as the last step.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcDir = Join-Path $scriptDir "..\src"
if (-not (Test-Path $srcDir)) {
    Write-Error "src/ directory not found at $srcDir"
    exit 1
}

$tsFiles = Get-ChildItem -Path $srcDir -Recurse -Filter "*.ts" -File
$forbidden = @()
foreach ($file in $tsFiles) {
    $matches_found = Select-String -Path $file.FullName -Pattern 'from\s+["''](node:fs|node:path|node:os)["'']'
    if ($matches_found) {
        $isExempt = $false
        $normalized = $file.FullName -replace "\\", "/"
        $normalized = $normalized -replace "^.*/gemiterm-bun-rewrite/", ""
        if ($normalized -eq "src/infrastructure/path-utils.ts") { $isExempt = $true }
        if ($normalized -eq "src/infrastructure/io.ts") { $isExempt = $true }
        if ($normalized -eq "src/services/install-browser-service.ts") { $isExempt = $true }
        if (-not $isExempt) {
            foreach ($m in $matches_found) {
                $forbidden += [PSCustomObject]@{
                    Path = $normalized
                    LineNumber = $m.LineNumber
                    Line = $m.Line.Trim()
                }
            }
        }
    }
}

if ($forbidden.Count -gt 0) {
    Write-Host "ERROR: forbidden direct imports of node:fs / node:path / node:os in src/." -ForegroundColor Red
    Write-Host ""
    Write-Host "All file-system and path operations must route through:"
    Write-Host "  - src/infrastructure/path-utils.ts (path values)"
    Write-Host "  - src/infrastructure/io.ts (file-system side effects)"
    Write-Host ""
    Write-Host "Offending imports:"
    foreach ($f in $forbidden) {
        Write-Host "  $($f.Path):$($f.LineNumber): $($f.Line)"
    }
    Write-Host ""
    Write-Host "If you have a legitimate need for a direct import, add the file to"
    Write-Host "the exemption list in this script and the CI workflow with a comment"
    Write-Host "explaining why."
    exit 1
}

Write-Host "OK: no forbidden node:fs / node:path / node:os imports in src/"
exit 0
