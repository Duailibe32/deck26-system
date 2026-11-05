param([string]$ApplicationDirectory="$env:USERPROFILE\Deck26\Aplicativo")
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Path $ApplicationDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'docs\CHECKLIST_VIDEO_FISCAL.html') -Destination (Join-Path $ApplicationDirectory 'CHECKLIST VIDEO FISCAL.html') -Force
$desktop=[Environment]::GetFolderPath('Desktop')
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut((Join-Path $desktop 'DECK 26 - Ensaio Fiscal.lnk'))
$shortcut.TargetPath=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $PSScriptRoot 'open-fiscal-presentation.ps1')+'"'
$shortcut.WorkingDirectory=$repo
$shortcut.Description='Apresentação fiscal local, dados separados, sem validade fiscal. PIN de exemplo 536821.'
$shortcut.IconLocation=(Join-Path $ApplicationDirectory 'Deck26-Operacao.exe')+',0'
$shortcut.Save()
Write-Output ('Atalho: '+(Join-Path $desktop 'DECK 26 - Ensaio Fiscal.lnk'))
