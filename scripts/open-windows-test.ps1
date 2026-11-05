param(
  [string]$ExecutablePath = "$env:LOCALAPPDATA\Deck26\Teste\Deck26-Teste.exe",
  [string]$TestDataDirectory = "$env:LOCALAPPDATA\Deck26\Teste\dados"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$testMutex = [System.Threading.Mutex]::new($false, 'Local\Deck26WindowsTest')
$ownsMutex = $false
$startedApi = $null
try {
  $ownsMutex = $testMutex.WaitOne(0)
  if (-not $ownsMutex) {
    [System.Windows.Forms.MessageBox]::Show('O DECK 26 de testes já está aberto. Procure a janela na barra de tarefas.', 'DECK 26 · Teste') | Out-Null
    exit 0
  }
  if (-not (Test-Path -LiteralPath $ExecutablePath)) { throw 'O executável de teste ainda não foi compilado ou não está na pasta configurada.' }
  $repoDirectory = Split-Path -Parent $PSScriptRoot
  $testServerScript = Join-Path $PSScriptRoot 'start-windows-test.mjs'
  $testNode = (Get-Command node -ErrorAction Stop).Source
  New-Item -ItemType Directory -Force -Path $TestDataDirectory | Out-Null
  $health = $null
  try { $health = Invoke-RestMethod 'http://127.0.0.1:4700/api/health' -TimeoutSec 2 } catch { }
  if ($health -and $health.testEnvironment -ne $true) { throw 'A porta de testes está ocupada por outro serviço. Nenhum banco foi alterado.' }
  if (-not $health) {
    $env:DECK26_TEST_DATA_DIR = $TestDataDirectory
    $startedApi = Start-Process -FilePath $testNode -ArgumentList @('--import', 'tsx', ('"' + $testServerScript + '"')) -WorkingDirectory $repoDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $TestDataDirectory 'servidor.log') -RedirectStandardError (Join-Path $TestDataDirectory 'servidor-erros.log')
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
      try { $health = Invoke-RestMethod 'http://127.0.0.1:4700/api/health' -TimeoutSec 1 } catch { }
      if ($health.testEnvironment -eq $true) { break }
      if ($startedApi.HasExited) { throw 'O servidor de testes não iniciou. Consulte servidor-erros.log na pasta dos testes.' }
      Start-Sleep -Milliseconds 250
    }
    if ($health.testEnvironment -ne $true) { throw 'O servidor de testes não ficou disponível. Consulte os arquivos de log.' }
  }
  # This visible window is the native application requested by the user.
  $nativeWindow = Start-Process -FilePath $ExecutablePath -WorkingDirectory (Split-Path -Parent $ExecutablePath) -PassThru
  $nativeWindow.WaitForExit()
} catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Não foi possível abrir o DECK 26 de testes') | Out-Null
  exit 1
} finally {
  if ($startedApi -and -not $startedApi.HasExited) { Stop-Process -Id $startedApi.Id -ErrorAction SilentlyContinue }
  if ($ownsMutex) { $testMutex.ReleaseMutex() }
  $testMutex.Dispose()
}
