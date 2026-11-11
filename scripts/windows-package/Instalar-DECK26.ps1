param(
  [string]$ApplicationDirectory = "$env:USERPROFILE\Deck26\Aplicativo",
  [string]$DataDirectory = "$env:USERPROFILE\Deck26\DadosOperacionais",
  [switch]$SemAtalho
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'WebView2-DECK26.ps1')
$payload = Join-Path $PSScriptRoot 'payload'
if (!(Test-Path -LiteralPath (Join-Path $payload 'ui\deck26-operation.json'))) {
  throw 'O pacote de instalação está incompleto. Baixe novamente o instalador.'
}
$manifest = Get-Content -LiteralPath (Join-Path $payload 'release.json') -Raw | ConvertFrom-Json
if ($manifest.repository -ne 'Duailibe32/deck26-system' -or $manifest.commit -notmatch '^[a-f0-9]{40}$') {
  throw 'O pacote não contém uma versão válida do DECK 26.'
}
$appRoot = [IO.Path]::GetFullPath($ApplicationDirectory)
$dataRoot = [IO.Path]::GetFullPath($DataDirectory)
if ($appRoot.TrimEnd('\') -eq $dataRoot.TrimEnd('\')) { throw 'Escolha pastas diferentes para o aplicativo e os dados.' }
$mutex = [Threading.Mutex]::new($false,'Local\Deck26LocalOperation')
$locked = $false
try {
  try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (!$locked) { throw 'Feche a janela do DECK 26 antes de instalar a atualização.' }
  Install-Deck26WebView2
  $versions = Join-Path $appRoot 'versoes'
  New-Item -ItemType Directory -Force -Path $versions | Out-Null
  $release = Join-Path $versions ($manifest.commit.Substring(0,7)+'-'+[guid]::NewGuid().ToString('N').Substring(0,6))
  Copy-Item -LiteralPath $payload -Destination $release -Recurse
  $runtime = Join-Path $release 'runtime'
  $node = Join-Path $runtime 'node.exe'
  $npm = Join-Path $runtime 'node_modules\npm\bin\npm-cli.js'
  if (!(Test-Path -LiteralPath $node) -or !(Test-Path -LiteralPath $npm)) { throw 'O pacote está sem o Node.js integrado.' }
  $previousPath = $env:Path
  Push-Location -LiteralPath $release
  try {
    $env:Path = "$runtime;$previousPath"
    & $node $npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar as dependências do pacote. Confira a internet e tente novamente.' }
    & $node --import tsx --input-type=module -e "await import('./apps/local-server/src/server.ts');"
    if ($LASTEXITCODE -ne 0) { throw 'A verificação do servidor instalado falhou.' }
  } finally { $env:Path = $previousPath; Pop-Location }

  $database = Join-Path $dataRoot 'deck26-operacao.sqlite'
  $backup = $null
  if (Test-Path -LiteralPath $database -PathType Leaf) {
    $backupDir = New-Item -ItemType Directory -Force -Path (Join-Path $dataRoot 'backups')
    $backup = Join-Path $backupDir.FullName ('deck26-atualizacao-'+[guid]::NewGuid().ToString('N')+'.sqlite')
    $backupCode = @'
import { DatabaseSync } from 'node:sqlite';
const [source,copy]=process.argv.slice(1);
const db=new DatabaseSync(source,{readOnly:true});
try { db.prepare('VACUUM INTO ?').run(copy); } finally { db.close(); }
const restored=new DatabaseSync(copy,{readOnly:true});
try {
  const result=restored.prepare('PRAGMA integrity_check').all();
  if(result.length!==1||result[0].integrity_check!=='ok'||restored.prepare('PRAGMA foreign_key_check').get())process.exitCode=1;
} finally { restored.close(); }
'@
    & $node --input-type=module -e $backupCode $database $backup
    if ($LASTEXITCODE -ne 0) { throw 'A cópia de segurança falhou. A nova versão ainda não foi ativada.' }
  }

  if (!$SemAtalho) {
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath('Desktop')
    $programs = [Environment]::GetFolderPath('Programs')
    $menu = New-Item -ItemType Directory -Force -Path (Join-Path $programs 'DECK 26')
    $powerShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $exe = Join-Path $release 'Deck26-Operacao.exe'
    $quote={param($value) '"'+($value -replace '(\\+)$','$1$1')+'"'}
    function Save-Shortcut($Location,$Script,$Options,$Description) {
      $shortcut = $shell.CreateShortcut($Location)
      $shortcut.TargetPath = $powerShell
      $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File '+(& $quote (Join-Path $release ('scripts\'+$Script)))+' '+$Options
      $shortcut.WorkingDirectory = $release
      $shortcut.IconLocation = $exe+',0'
      $shortcut.Description = $Description
      $shortcut.Save()
    }
    $launchOptions='-ApplicationDirectory '+(& $quote $release)+' -DataDirectory '+(& $quote $dataRoot)
    Save-Shortcut (Join-Path $menu.FullName 'Verificar atualizações.lnk') 'check-windows-update.ps1' ('-ApplicationDirectory '+(& $quote $appRoot)+' -DataDirectory '+(& $quote $dataRoot)) 'Consulta o instalador validado no GitHub.'
    Save-Shortcut (Join-Path $menu.FullName 'Abrir DECK 26.lnk') 'open-local-operation.ps1' $launchOptions 'Inicia o servidor local e abre o DECK 26.'
    Save-Shortcut (Join-Path $desktop 'DECK 26 - Operacao Local.lnk') 'open-local-operation.ps1' $launchOptions 'Inicia o servidor local e abre o DECK 26.'
  }
  $statePath=Join-Path $appRoot 'instalacao.json'
  $previous=$null
  if(Test-Path -LiteralPath $statePath){
    try{$previous=(Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json).release}catch{}
  }
  if(!$previous -and (Test-Path -LiteralPath (Join-Path $appRoot 'Deck26-Operacao.exe') -PathType Leaf)){
    $previous=$appRoot
  }
  $record=[ordered]@{version=$manifest.version;commit=$manifest.commit;installedAt=[DateTime]::UtcNow.ToString('o');release=$release;previousRelease=$previous;dataDirectory=$dataRoot;backup=$backup}
  $temporary=$statePath+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
  [IO.File]::WriteAllText($temporary,($record|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
  if(Test-Path -LiteralPath $statePath){[IO.File]::Replace($temporary,$statePath,($statePath+'.anterior'))}
  else{[IO.File]::Move($temporary,$statePath)}
  Write-Output ('Aplicativo instalado em '+$release)
  Write-Output ('Diretório de dados '+$dataRoot)
  if($backup){Write-Output ('Backup anterior à atualização: '+$backup)}
} finally {
  if($locked){$mutex.ReleaseMutex()}
  $mutex.Dispose()
}
