param()
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
$node=(Get-Command node -ErrorAction Stop).Source
try { $health=Invoke-RestMethod 'http://127.0.0.1:4802/api/health' -TimeoutSec 2 } catch { $health=$null }
if($health){throw 'A porta de apresentação 4802 já está em uso. Abra http://127.0.0.1:4802 no navegador.'}
$process=Start-Process -FilePath $node -ArgumentList @('--import','tsx',('"'+(Join-Path $PSScriptRoot 'start-fiscal-presentation.mjs')+'"')) -WorkingDirectory $repo -WindowStyle Hidden -PassThru
try {
 for($i=0;$i -lt 50;$i++){try {$health=Invoke-RestMethod 'http://127.0.0.1:4802/api/health' -TimeoutSec 1}catch{};if($health){break};if($process.HasExited){throw 'Não foi possível iniciar o ensaio fiscal.'};Start-Sleep -Milliseconds 250}
 if(-not $health){throw 'O ensaio não respondeu.'}
 Start-Process 'http://127.0.0.1:4802'
 Add-Type -AssemblyName System.Windows.Forms
 [System.Windows.Forms.MessageBox]::Show('O ensaio está aberto no navegador. PIN de apresentação: 536821. Ao terminar a gravação, clique OK aqui para desligar SOMENTE o ensaio. A operação real não será afetada.','DECK 26 — Ensaio fiscal') | Out-Null
} finally {if(-not $process.HasExited){Stop-Process -Id $process.Id}}
