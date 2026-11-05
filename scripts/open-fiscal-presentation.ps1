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
 $form=New-Object System.Windows.Forms.Form
 $form.Text='DECK 26 — Ensaio fiscal em funcionamento'
 $form.Size=New-Object System.Drawing.Size(540,275)
 $form.StartPosition='CenterScreen'
 $form.BackColor=[System.Drawing.Color]::FromArgb(26,26,26)
 $form.ForeColor=[System.Drawing.Color]::White
 $form.FormBorderStyle='FixedDialog'
 $form.MaximizeBox=$false
 $label=New-Object System.Windows.Forms.Label
 $label.Text="APRESENTAÇÃO LOCAL ATIVA"+[Environment]::NewLine+[Environment]::NewLine+"PIN de exemplo: 536821"+[Environment]::NewLine+"Pode minimizar esta janela enquanto testa ou grava."+[Environment]::NewLine+"Ao terminar, clique em Encerrar apresentação."
 $label.Location=New-Object System.Drawing.Point(24,20)
 $label.Size=New-Object System.Drawing.Size(480,140)
 $label.Font=New-Object System.Drawing.Font('Segoe UI',11)
 $form.Controls.Add($label)
 $open=New-Object System.Windows.Forms.Button
 $open.Text='Abrir sistema'
 $open.Location=New-Object System.Drawing.Point(24,170)
 $open.Size=New-Object System.Drawing.Size(180,40)
 $open.Add_Click({Start-Process 'http://127.0.0.1:4802'})
 $form.Controls.Add($open)
 $stop=New-Object System.Windows.Forms.Button
 $stop.Text='Encerrar apresentação'
 $stop.Location=New-Object System.Drawing.Point(230,170)
 $stop.Size=New-Object System.Drawing.Size(260,40)
 $stop.BackColor=[System.Drawing.Color]::FromArgb(255,179,207)
 $stop.ForeColor=[System.Drawing.Color]::Black
 $stop.Add_Click({$form.Close()})
 $form.Controls.Add($stop)
 $form.ShowDialog() | Out-Null
 $form.Dispose()
} finally {if(-not $process.HasExited){Stop-Process -Id $process.Id}}
