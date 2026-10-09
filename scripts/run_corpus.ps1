param(
  [string]$Mode = "all",
  [string]$LogName = "c2_all.log"
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$out = Join-Path $repo "docs\$LogName"
$err = Join-Path $repo "docs\$LogName.err"
$py = (Get-Command python).Source
Start-Process -FilePath $py -ArgumentList @("-u", "scripts\wq_adversarial_corpus.py", $Mode) `
  -WorkingDirectory $repo -NoNewWindow `
  -RedirectStandardOutput $out -RedirectStandardError $err
Write-Host "launched mode=$Mode -> $out"
