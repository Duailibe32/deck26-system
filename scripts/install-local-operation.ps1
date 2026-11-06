param(
  [string]$ApplicationDirectory = "$env:USERPROFILE\Deck26\Aplicativo",
  [string]$DataDirectory = "$env:USERPROFILE\Deck26\DadosOperacionais"
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$target = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { "$env:LOCALAPPDATA\Deck26\build-target" }
$source = Join-Path $target 'release\deck26-desktop.exe'
$ui = Join-Path $repo 'apps\desktop\dist'
if (-not (Test-Path -LiteralPath (Join-Path $ui 'deck26-operation.json'))) { throw 'Compile a versão operacional com npm run build:windows:local.' }
New-Item -ItemType Directory -Force -Path $ApplicationDirectory | Out-Null
$destination = Join-Path $ApplicationDirectory 'Deck26-Operacao.exe'
Copy-Item -LiteralPath $source -Destination $destination
$uiDestination = Join-Path $ApplicationDirectory 'ui'
New-Item -ItemType Directory -Force -Path $uiDestination | Out-Null
Get-ChildItem -LiteralPath $ui | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $uiDestination -Recurse -Force }
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $desktop 'DECK 26 - Operacao Local.lnk'))
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $PSScriptRoot 'open-local-operation.ps1')+'" -ApplicationDirectory "'+$ApplicationDirectory+'" -DataDirectory "'+$DataDirectory+'"'
$shortcut.WorkingDirectory = $repo
$shortcut.IconLocation = $destination+',0'
$shortcut.Description = 'Operação local do DECK 26 — dados próprios, caixa, hotel e atendimento Wi-Fi.'
$shortcut.Save()
Copy-Item -LiteralPath (Join-Path $repo 'docs\CHECKLIST_OPERACIONAL.html') -Destination (Join-Path $ApplicationDirectory 'CHECKLIST OPERACIONAL.html') -Force
Copy-Item -LiteralPath (Join-Path $repo 'docs\CHECKLIST_COMPLETO.html') -Destination (Join-Path $ApplicationDirectory 'CHECKLIST COMPLETO.html') -Force
Copy-Item -LiteralPath (Join-Path $repo 'docs\CHECKLIST_COMPLETO.md') -Destination (Join-Path $ApplicationDirectory 'CHECKLIST COMPLETO.md') -Force
Write-Output ('Atalho: '+(Join-Path $desktop 'DECK 26 - Operacao Local.lnk'))
Write-Output ('Aplicativo: '+$destination)
Write-Output ('Dados próprios: '+$DataDirectory)

Copy-Item -LiteralPath (Join-Path $repo 'docs\CHECKLIST_DELIVERY.html') -Destination (Join-Path $ApplicationDirectory 'CHECKLIST DELIVERY.html') -Force
Copy-Item -LiteralPath (Join-Path $repo 'docs\CHECKLIST_DELIVERY.md') -Destination (Join-Path $ApplicationDirectory 'CHECKLIST DELIVERY.md') -Force
