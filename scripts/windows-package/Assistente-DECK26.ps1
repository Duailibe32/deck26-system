param(
  [string]$ApplicationDirectory = "$env:USERPROFILE\Deck26\Aplicativo",
  [string]$DataDirectory = "$env:USERPROFILE\Deck26\DadosOperacionais",
  [switch]$VerificarInterface,
  [string]$Captura
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

$surface = [Drawing.Color]::FromArgb(24, 20, 25)
$panel = [Drawing.Color]::FromArgb(39, 29, 39)
$text = [Drawing.Color]::FromArgb(255, 238, 247)
$muted = [Drawing.Color]::FromArgb(218, 190, 205)
$pink = [Drawing.Color]::FromArgb(247, 37, 133)
$form = New-Object Windows.Forms.Form
$form.Text = 'Instalador DECK 26'
$form.ClientSize = [Drawing.Size]::new(748, 548)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.StartPosition = 'CenterScreen'
$form.BackColor = $surface
$form.ForeColor = $text
$form.AutoScaleMode = 'Dpi'
$form.Font = [Drawing.Font]::new('Segoe UI', 10)

function Add-Label($Parent,[string]$Value,[int]$X,[int]$Y,[int]$Width,[int]$Height,[int]$Size,[Drawing.Color]$Color,[switch]$Bold) {
  $control = New-Object Windows.Forms.Label
  $control.Text = $Value
  $control.SetBounds($X,$Y,$Width,$Height)
  $control.ForeColor = $Color
  $style = if($Bold){[Drawing.FontStyle]::Bold}else{[Drawing.FontStyle]::Regular}
  $control.Font = [Drawing.Font]::new('Segoe UI',$Size,$style)
  $Parent.Controls.Add($control)
  return $control
}
function Add-Button($Parent,[string]$Value,[int]$X,[int]$Y,[int]$Width,[int]$Height,[Drawing.Color]$Color) {
  $control = New-Object Windows.Forms.Button
  $control.Text = $Value
  $control.SetBounds($X,$Y,$Width,$Height)
  $control.FlatStyle = 'Flat'
  $control.FlatAppearance.BorderSize = 0
  $control.BackColor = $Color
  $control.ForeColor = $text
  $control.Font = [Drawing.Font]::new('Segoe UI',10,[Drawing.FontStyle]::Bold)
  $Parent.Controls.Add($control)
  return $control
}
function Add-DirectoryField([string]$Label,[string]$Value,[int]$Y) {
  $null = Add-Label $form $Label 26 $Y 670 23 10 $text -Bold
  $field = New-Object Windows.Forms.TextBox
  $field.Text = $Value
  $field.AccessibleName = $Label
  $field.SetBounds(28,($Y+25),570,30)
  $field.BackColor = $panel
  $field.ForeColor = $text
  $form.Controls.Add($field)
  $browse = Add-Button $form 'Escolher' 607 ($Y+23) 113 30 $panel
  $browse.AccessibleName = 'Escolher '+$Label
  $browse.Add_Click({
    $dialog = New-Object Windows.Forms.FolderBrowserDialog
    $dialog.Description = $Label
    try {
      if(Test-Path -LiteralPath $field.Text){$dialog.SelectedPath=$field.Text}
      if($dialog.ShowDialog($form) -eq 'OK'){$field.Text=$dialog.SelectedPath}
    } finally { $dialog.Dispose() }
  }.GetNewClosure())
  return @{ Field=$field; Browse=$browse }
}

$header = New-Object Windows.Forms.Panel
$header.SetBounds(0,0,748,145)
$header.BackColor = [Drawing.Color]::FromArgb(54, 26, 55)
$form.Controls.Add($header)
$accent = New-Object Windows.Forms.Panel
$accent.SetBounds(0,0,748,5)
$accent.BackColor = $pink
$header.Controls.Add($accent)
$null = Add-Label $header 'DECK 26  /  HOTEL AUTO POSTO MILLA' 24 23 680 24 11 $muted -Bold
$null = Add-Label $header 'Instalação do DECK 26' 24 49 700 51 25 $text -Bold
$null = Add-Label $header 'Restaurante, bar, delivery e hotel na rede local.' 26 107 690 23 11 $muted
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'payload\release.json') -Raw | ConvertFrom-Json
$shortCommit = ([string]$manifest.commit).Substring(0,7)
$null = Add-Label $form ('Versão '+$shortCommit+'  ·  Windows') 26 158 695 23 10 $muted
$application = Add-DirectoryField 'Pasta do aplicativo' $ApplicationDirectory 196
$data = Add-DirectoryField 'Pasta dos dados do estabelecimento' $DataDirectory 270
$null = Add-Label $form 'Se houver uma base nesta pasta, o instalador cria uma cópia de segurança antes de ativar a versão.' 26 334 690 44 10 $muted
$status = Add-Label $form 'Requisitos: Node.js 22.13 ou superior, npm, WebView2 e internet para instalar as dependências.' 26 392 694 45 10 $muted
$progress = New-Object Windows.Forms.ProgressBar
$progress.SetBounds(28,450,692,9)
$progress.Style = 'Marquee'
$progress.MarqueeAnimationSpeed = 35
$progress.Visible = $false
$form.Controls.Add($progress)
$cancel = Add-Button $form 'Fechar' 430 486 120 40 $panel
$install = Add-Button $form 'Instalar DECK 26' 562 486 158 40 $pink
$form.AcceptButton = $install
$cancel.Add_Click({$form.Close()})

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 300
$script:process = $null
$script:exitCode = 0
$script:log = ''
$form.Add_FormClosing({
  if($script:process -and !$script:process.HasExited){
    $_.Cancel=$true
    $status.Text='A instalação está em andamento. Aguarde a conclusão.'
  }
})
$timer.Add_Tick({
  if(!$script:process -or !$script:process.HasExited){return}
  $timer.Stop()
  $progress.Visible=$false
  $cancel.Enabled=$true
  if($script:process.ExitCode -eq 0){
    $script:exitCode=0
    $status.ForeColor=[Drawing.Color]::FromArgb(162,235,190)
    $status.Text='Instalação concluída. Abra o DECK 26 pela área de trabalho ou pelo menu Iniciar.'
    $cancel.Text='Concluir'
    $form.AcceptButton=$cancel
  }else{
    $script:exitCode=1
    $status.ForeColor=[Drawing.Color]::FromArgb(255,164,193)
    $status.Text='A instalação falhou. Consulte o log: '+$script:log
    foreach($control in @($application.Field,$application.Browse,$data.Field,$data.Browse,$install)){$control.Enabled=$true}
  }
  $script:process.Dispose()
  $script:process=$null
})
$install.Add_Click({
  try {
    $appPath=[IO.Path]::GetFullPath($application.Field.Text)
    $dataPath=[IO.Path]::GetFullPath($data.Field.Text)
    if($appPath.TrimEnd('\') -eq $dataPath.TrimEnd('\')){throw 'Escolha pastas diferentes para o aplicativo e os dados.'}
    if([Windows.Forms.MessageBox]::Show($form,('Instalar a versão '+$shortCommit+'? Feche o DECK 26 se ele estiver aberto.'),'Confirmar instalação','OKCancel','Question') -ne 'OK'){return}
    $logs=New-Item -ItemType Directory -Force -Path (Join-Path $env:LOCALAPPDATA 'Deck26\Instalacao\logs')
    $script:log=Join-Path $logs.FullName ('instalacao-'+[guid]::NewGuid().ToString('N').Substring(0,8)+'.log')
    $quoted={param($value) '"'+($value -replace '(\\+)$','$1$1')+'"'}
    $core=Join-Path $PSScriptRoot 'Instalar-DECK26.ps1'
    $arguments='-NoProfile -ExecutionPolicy Bypass -File '+(& $quoted $core)+' -ApplicationDirectory '+(& $quoted $appPath)+' -DataDirectory '+(& $quoted $dataPath)
    $script:process=Start-Process -FilePath (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput ($script:log+'.out') -RedirectStandardError $script:log
    foreach($control in @($application.Field,$application.Browse,$data.Field,$data.Browse,$install,$cancel)){$control.Enabled=$false}
    $status.ForeColor=$muted
    $status.Text='Preparando a versão e instalando as dependências. Aguarde…'
    $progress.Visible=$true
    $timer.Start()
  }catch{
    $status.ForeColor=[Drawing.Color]::FromArgb(255,164,193)
    $status.Text=$_.Exception.Message
  }
})

if($VerificarInterface){
  if($Captura){
    $form.Show()
    [Windows.Forms.Application]::DoEvents()
    $bitmap=[Drawing.Bitmap]::new($form.Width,$form.Height)
    try{$form.DrawToBitmap($bitmap,[Drawing.Rectangle]::new(0,0,$form.Width,$form.Height));$bitmap.Save($Captura)}finally{$bitmap.Dispose()}
    $form.Close()
  }
  $timer.Dispose()
  $form.Dispose()
  exit 0
}
[void]$form.ShowDialog()
$timer.Dispose()
$form.Dispose()
exit $script:exitCode
