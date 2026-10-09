param(
  [string]$Log = "c4_ui_run.log",
  [string]$InjLevel = "1"
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $repo "tools\pwtest")
$env:SITE_URL = "http://localhost:4173/"
$env:WQ_UI_MODE = "injection"
$env:WQ_INJ_LEVEL = $InjLevel
Remove-Item Env:\WQ_LEVELS -ErrorAction SilentlyContinue
Remove-Item Env:\DRY_NAV -ErrorAction SilentlyContinue
node levels_payout.mjs *>&1 | Tee-Object -FilePath (Join-Path $repo "docs\$Log")
Write-Host "harness exit code: $LASTEXITCODE"
