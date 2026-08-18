$ErrorActionPreference = 'Stop'
Write-Host "Running: bunx @playwright/cli install-browser chrome-for-testing"
$output = & bunx @playwright/cli install-browser chrome-for-testing 2>&1
Write-Host $output
Write-Host "Browser installation complete."