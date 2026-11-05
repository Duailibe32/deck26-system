param(
  [string]$ApplicationDirectory = "$env:LOCALAPPDATA\Deck26\Teste",
  [string]$TestDataDirectory = "$env:LOCALAPPDATA\Deck26\Teste\dados"
)
$ErrorActionPreference = 'Stop'
$cargoOutput = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { "$env:LOCALAPPDATA\Deck26\build-target" }
$builtExecutable = Join-Path $cargoOutput 'release\deck26-desktop.exe'
if (-not (Test-Path -LiteralPath $builtExecutable)) { throw 'Execute npm run build:windows:test antes de criar o atalho.' }
New-Item -ItemType Directory -Force -Path $ApplicationDirectory | Out-Null
$executable = Join-Path $ApplicationDirectory 'Deck26-Teste.exe'
Copy-Item -LiteralPath $builtExecutable -Destination $executable
$launcher = Join-Path $PSScriptRoot 'open-windows-test.ps1'
$shell = New-Object -ComObject WScript.Shell
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DECK 26 - Teste Windows.lnk'
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '" -ExecutablePath "' + $executable + '" -TestDataDirectory "' + $TestDataDirectory + '"'
$shortcut.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$shortcut.IconLocation = $executable + ',0'
$shortcut.Description = 'DECK 26 nativo — base de testes persistente, separada da operação real.'
$shortcut.Save()
@"
DECK 26 — TESTE WINDOWS

Abra pelo atalho DECK 26 - Teste Windows na Área de Trabalho.
O atalho inicia a API local e abre a janela nativa automaticamente.

LOGIN DE TESTE
Proprietário: 2626
Gerente: 1010
Caixa: 2020
Garçom: 3030
Cozinha: 4040
Recepção: 5050

Use somente nomes e valores fictícios. Não há cobrança bancária ou emissão fiscal real.
Os dados são salvos após cada operação e permanecem ao fechar/reabrir.
Pasta dos dados de teste: $TestDataDirectory

ROTEIRO
1. Entre como proprietário (2626).
2. Confira o caixa. A base de demonstração já pode ter um turno aberto.
3. Abra uma mesa livre, lance um produto e acompanhe na cozinha.
4. Solicite a conta, confira a mesa vermelha e registre um pagamento fictício.
5. Encerre a comanda e confira os movimentos financeiros.
6. Teste hospedagem e consumo no quarto com um hóspede fictício.
7. Use Sair / trocar operador para conhecer as permissões de cada perfil.

Este teste exige Node.js e o repositório com npm ci instalado neste computador.
O executável não incorpora a API; use o atalho para iniciar os dois componentes.
Impressoras, bancos/adquirentes, emissão fiscal e implantação online não estão homologados por este teste.
"@ | Set-Content -LiteralPath (Join-Path $ApplicationDirectory 'COMO TESTAR.txt') -Encoding UTF8
Write-Output "Atalho criado: $shortcutPath"
Write-Output "Executável: $executable"
Write-Output "Dados de teste: $TestDataDirectory"
