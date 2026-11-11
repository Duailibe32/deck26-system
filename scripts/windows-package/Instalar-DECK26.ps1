param(
  [string]$ApplicationDirectory = "$env:USERPROFILE\Deck26\Aplicativo",
  [string]$DataDirectory = "$env:USERPROFILE\Deck26\DadosOperacionais",
  [switch]$SemAtalho
)
$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
& $node -e "const [m,n]=process.versions.node.split('.').map(Number); if(m<22||(m===22&&n<13)) process.exit(1); require('node:sqlite');"
if ($LASTEXITCODE -ne 0) { throw 'Instale Node.js 22.13 ou superior antes de continuar.' }
$payload = Join-Path $PSScriptRoot 'payload'
if (!(Test-Path -LiteralPath (Join-Path $payload 'ui\deck26-operation.json'))) {
  throw 'Extraia todo o ZIP antes de executar o instalador.'
}
$versions = Join-Path ([IO.Path]::GetFullPath($ApplicationDirectory)) 'versoes'
New-Item -ItemType Directory -Force -Path $versions | Out-Null
$release = Join-Path $versions ((Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6))
Copy-Item -LiteralPath $payload -Destination $release -Recurse
Push-Location -LiteralPath $release
try {
  & $npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependências. Confira a conexão e execute o instalador novamente.' }
  & $node --import tsx --input-type=module -e "await import('./apps/local-server/src/server.ts');"
  if ($LASTEXITCODE -ne 0) { throw 'A verificação do servidor instalado falhou.' }
} finally { Pop-Location }

if (!$SemAtalho) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut((Join-Path $desktop 'DECK 26 - Operacao Local.lnk'))
  $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $launcher = Join-Path $release 'scripts\open-local-operation.ps1'
  $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$launcher+'" -ApplicationDirectory "'+$release+'" -DataDirectory "'+[IO.Path]::GetFullPath($DataDirectory)+'"'
  $shortcut.WorkingDirectory = $release
  $shortcut.IconLocation = (Join-Path $release 'Deck26-Operacao.exe')+',0'
  $shortcut.Description = 'Inicia o servidor local e abre o DECK 26.'
  $shortcut.Save()
}
Write-Output ('Aplicativo instalado em '+$release)
Write-Output ('Diretório de dados '+[IO.Path]::GetFullPath($DataDirectory))
