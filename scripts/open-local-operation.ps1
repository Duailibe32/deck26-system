param(
  [string]$ApplicationDirectory = "$env:USERPROFILE\Deck26\Aplicativo",
  [string]$DataDirectory = "$env:USERPROFILE\Deck26\DadosOperacionais"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$mutex = [System.Threading.Mutex]::new($false, 'Local\Deck26LocalOperation')
$owns = $false
$server = $null
try {
  $owns = $mutex.WaitOne(0)
  if (-not $owns) { [System.Windows.Forms.MessageBox]::Show('A operação local já está aberta. Procure a janela na barra de tarefas.', 'DECK 26') | Out-Null; exit 0 }
  $exe = Join-Path $ApplicationDirectory 'Deck26-Operacao.exe'
  if (-not (Test-Path -LiteralPath $exe)) { throw 'O aplicativo operacional ainda não foi instalado.' }
  New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
  $health = $null
  try { $health = Invoke-RestMethod 'http://127.0.0.1:4800/api/health' -TimeoutSec 2 } catch { }
  if ($health -and $health.operationalEnvironment -ne $true) { throw 'A porta 4800 está ocupada por outro serviço. Nenhum banco foi alterado.' }
  if (-not $health) {
    $repo = Split-Path -Parent $PSScriptRoot
    $env:DECK26_OPERATION_DATA_DIR = $DataDirectory
    $env:DECK26_OPERATION_UI_DIR = Join-Path $ApplicationDirectory 'ui'
    $node = (Get-Command node -ErrorAction Stop).Source
    $script = Join-Path $PSScriptRoot 'start-local-operation.mjs'
    $server = Start-Process -FilePath $node -ArgumentList @('--import','tsx',('"'+$script+'"')) -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $DataDirectory 'servidor.log') -RedirectStandardError (Join-Path $DataDirectory 'servidor-erros.log')
    for ($i=0; $i -lt 60; $i++) {
      try { $health = Invoke-RestMethod 'http://127.0.0.1:4800/api/health' -TimeoutSec 1 } catch { }
      if ($health.operationalEnvironment -eq $true) { break }
      if ($server.HasExited) { throw ('O servidor não iniciou. Consulte '+(Join-Path $DataDirectory 'servidor-erros.log')) }
      Start-Sleep -Milliseconds 250
    }
    if ($health.operationalEnvironment -ne $true) { throw 'A operação local não ficou disponível.' }
  }
  $window = Start-Process -FilePath $exe -WorkingDirectory $ApplicationDirectory -PassThru
  $window.WaitForExit()
} catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Não foi possível abrir o DECK 26') | Out-Null
  exit 1
} finally {
  if ($server -and -not $server.HasExited) {
    try {
      $secrets = Get-Content -LiteralPath (Join-Path $DataDirectory 'segredos-locais.json') -Raw | ConvertFrom-Json
      Invoke-RestMethod 'http://127.0.0.1:4800/api/_local/stop' -Method Post -ContentType 'application/json' -Body '{}' -Headers @{'X-Deck26-Control'=$secrets.control} -TimeoutSec 3 | Out-Null
      $server.WaitForExit(20000) | Out-Null
    } catch { }
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
  }
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
