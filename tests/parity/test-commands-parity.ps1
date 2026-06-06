#Requires -Version 5.1
[CmdletBinding()]
param(
  [string[]]$Commands,
  [string]$PythonCli = $(if ($env:GEMITERM_PYTHON_CLI) { $env:GEMITERM_PYTHON_CLI } else { "gemiterm" }),
  [string]$ReportDir
)

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$CompareScript = Join-Path $ProjectRoot "tests\parity\compare-outputs.ts"

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Error "ERROR: bun is not installed or not on PATH"
  exit 1
}

if (-not $ReportDir) {
  $ReportDir = Join-Path $ProjectRoot "reports\parity"
}

$DefaultCommands = @(
  "--help",
  "--version",
  "auth --help",
  "status --help",
  "list --help",
  "fetch --help",
  "continue --help",
  "new --help",
  "delete --help",
  "export --help",
  "export-all --help",
  "profile --help",
  "status",
  "list",
  "list --limit 5",
  "list --format json",
  "auth"
)

$Cmds = if ($Commands -and $Commands.Count -gt 0) { $Commands } else { $DefaultCommands }

Write-Host "=== GemiTerm Parity Test Suite ==="
Write-Host "Python CLI : $PythonCli"
Write-Host "Bun CLI    : bun run $CompareScript"
Write-Host "Commands   : $($Cmds.Count)"
Write-Host ""

if (-not (Test-Path $ReportDir)) {
  New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ReportFile = Join-Path $ReportDir "parity-$Timestamp.txt"

$CommaSeparated = $Cmds -join ","

Write-Host "Running parity comparison..."

$env:GEMITERM_PYTHON_CLI = $PythonCli

try {
  $output = & bun $CompareScript --commands $CommaSeparated 2>&1
  $output | Out-File -FilePath $ReportFile -Encoding utf8
  $output | ForEach-Object { Write-Host $_ }

  Write-Host ""
  Write-Host "Parity report saved to: $ReportFile"
  exit 0
} catch {
  $exitCode = $LASTEXITCODE
  $output | Out-File -FilePath $ReportFile -Encoding utf8
  $output | ForEach-Object { Write-Host $_ }

  Write-Host ""
  Write-Host "Parity report saved to: $ReportFile"
  Write-Host "Some tests FAILED. Review the report above."
  exit 1
}
