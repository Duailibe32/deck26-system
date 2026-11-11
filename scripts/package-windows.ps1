param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$target = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { "$env:LOCALAPPDATA\Deck26\build-target" }
$exe = Join-Path $target 'release\deck26-desktop.exe'
$ui = Join-Path $repo 'apps\desktop\dist'
if (!(Test-Path -LiteralPath $exe) -or !(Test-Path -LiteralPath (Join-Path $ui 'deck26-operation.json'))) {
  throw 'Execute npm run build:windows:local antes de montar o pacote.'
}
$version = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$stage = Join-Path (New-Item -ItemType Directory -Force -Path $OutputDirectory).FullName ('DECK26-Instalacao-' + $version)
New-Item -ItemType Directory -Path $stage | Out-Null
$payload = Join-Path $stage 'payload'
New-Item -ItemType Directory -Path $payload | Out-Null

$items = @(
  'package.json','package-lock.json','tsconfig.base.json',
  'apps\local-server\package.json','apps\local-server\src',
  'apps\desktop\package.json','apps\cloud-api\package.json','apps\web\package.json',
  'packages\contracts\package.json','packages\contracts\src','packages\contracts\migrations',
  'packages\ui\package.json','scripts\open-local-operation.ps1','scripts\start-local-operation.mjs',
  'docs\CHECKLIST_OPERACIONAL.html','docs\CHECKLIST_COMPLETO.html','docs\BACKUP_AND_RECOVERY.md'
)
foreach ($item in $items) {
  $destination = Join-Path $payload $item
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath (Join-Path $repo $item) -Destination $destination -Recurse
}
Copy-Item -LiteralPath $exe -Destination (Join-Path $payload 'Deck26-Operacao.exe')
Copy-Item -LiteralPath $ui -Destination (Join-Path $payload 'ui') -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-package\Instalar-DECK26.ps1') -Destination $stage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-package\Instalar-DECK26.cmd') -Destination $stage
$archive = $stage + '.zip'
Compress-Archive -LiteralPath $stage -DestinationPath $archive
Write-Output $archive
