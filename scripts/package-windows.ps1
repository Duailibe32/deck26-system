param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$target = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { "$env:LOCALAPPDATA\Deck26\build-target" }
$exe = Join-Path $target 'release\deck26-desktop.exe'
$ui = Join-Path $repo 'apps\desktop\dist'
if (!(Test-Path -LiteralPath $exe) -or !(Test-Path -LiteralPath (Join-Path $ui 'deck26-operation.json'))) {
  throw 'Execute npm run build:windows:local antes de montar o pacote.'
}
$commit = if ($env:GITHUB_SHA) { $env:GITHUB_SHA } else { & git -C $repo rev-parse HEAD }
if ($commit -notmatch '^[a-f0-9]{40}$') { throw 'Não foi possível identificar o commit desta versão.' }
$output = (New-Item -ItemType Directory -Force -Path $OutputDirectory).FullName
$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$stage = Join-Path $temp ('deck26-build-installer-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$bundle=Join-Path $stage 'DECK26'
$payload = Join-Path $bundle 'payload'
New-Item -ItemType Directory -Path $bundle | Out-Null
New-Item -ItemType Directory -Path $payload | Out-Null
try {

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
$packageSource=Join-Path $PSScriptRoot 'windows-package'
$utf8Bom=[Text.UTF8Encoding]::new($true)
foreach($name in @('Instalar-DECK26.ps1','Assistente-DECK26.ps1')){
  [IO.File]::WriteAllText((Join-Path $bundle $name),[IO.File]::ReadAllText((Join-Path $packageSource $name)),$utf8Bom)
}
[IO.File]::WriteAllText((Join-Path $payload 'scripts\check-windows-update.ps1'),[IO.File]::ReadAllText((Join-Path $packageSource 'check-windows-update.ps1')),$utf8Bom)
$manifest=[ordered]@{schemaVersion=1;repository='Duailibe32/deck26-system';commit=$commit;builtAt=[DateTime]::UtcNow.ToString('o')}
[IO.File]::WriteAllText((Join-Path $payload 'release.json'),($manifest|ConvertTo-Json),$utf8Bom)

$archive=Join-Path $stage 'pacote.zip'
Compress-Archive -LiteralPath $bundle -DestinationPath $archive
$framework=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler=Join-Path $framework 'csc.exe'
if(!(Test-Path -LiteralPath $compiler)){throw 'Compilador .NET Framework necessário para montar o instalador.'}
$setup=Join-Path $stage 'DECK26-Instalador.exe'
$icon=Join-Path $repo 'apps\desktop\src-tauri\icons\icon.ico'
& $compiler '/nologo' '/target:winexe' '/optimize+' '/codepage:65001' ("/out:$setup") ("/win32icon:$icon") ("/resource:$archive,Deck26.package.zip") '/reference:System.Windows.Forms.dll' '/reference:System.IO.Compression.dll' '/reference:System.IO.Compression.FileSystem.dll' (Join-Path $packageSource 'Deck26Setup.cs')
if($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $setup)){throw 'Falha ao compilar o instalador DECK 26.'}
$manifest.sha256=(Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash
Copy-Item -LiteralPath $setup -Destination (Join-Path $output 'DECK26-Instalador.exe') -Force
[IO.File]::WriteAllText((Join-Path $output 'release.json'),($manifest|ConvertTo-Json),$utf8Bom)
Write-Output (Join-Path $output 'DECK26-Instalador.exe')
} finally {
  if(Test-Path -LiteralPath $stage){
    $resolved=(Resolve-Path -LiteralPath $stage).Path
    if($resolved -eq $stage -and (Split-Path -Parent $resolved) -eq $temp -and (Split-Path -Leaf $resolved) -match '^deck26-build-installer-[a-f0-9]{32}$'){
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  }
}
