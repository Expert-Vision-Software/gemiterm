$ErrorActionPreference = 'Stop'
Remove-Item -Recurse -Force dist/ -ErrorAction SilentlyContinue
Remove-Item -Force bun.lock.bak -ErrorAction SilentlyContinue
Write-Host "Build artifacts cleaned."