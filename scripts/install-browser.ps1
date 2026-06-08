$ErrorActionPreference = 'Stop'
Write-Host "Running: bunx @playwright/cli install chromium"
$output = & bunx @playwright/cli install chromium 2>&1
Write-Host $output
Write-Host "Browser installation complete."