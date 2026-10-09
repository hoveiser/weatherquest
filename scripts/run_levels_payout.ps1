param(
  [string]$Levels = "1,2,3",
  [string]$Log = "realrun_123.log",
  [switch]$Dry
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $repo "tools\pwtest")
$env:SITE_URL = "http://localhost:4173/"
$env:WQ_LEVELS = $Levels
if ($Dry) { $env:DRY_NAV = "1" } else { Remove-Item Env:\DRY_NAV -ErrorAction SilentlyContinue }
node levels_payout.mjs *>&1 | Tee-Object -FilePath (Join-Path $repo "docs\$Log")
Write-Host "harness exit code: $LASTEXITCODE"
