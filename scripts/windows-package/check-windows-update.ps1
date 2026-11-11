param(
  [string]$ApplicationDirectory = "$env:USERPROFILE\Deck26\Aplicativo",
  [string]$DataDirectory = "$env:USERPROFILE\Deck26\DadosOperacionais",
  [switch]$SomenteBaixar,
  [string]$DiretorioSaida
)
$ErrorActionPreference = 'Stop'
$repository='Duailibe32/deck26-system'
$workflowUrl='https://github.com/'+$repository+'/releases/latest'
$download=$null
if(!$SomenteBaixar){Add-Type -AssemblyName System.Windows.Forms}
function Show-Message([string]$Message){
  if($SomenteBaixar){Write-Output $Message}
  else{[void][Windows.Forms.MessageBox]::Show($Message,'Atualizações · DECK 26','OK','Information')}
}
try{
  $gh=Get-Command gh.exe -ErrorAction SilentlyContinue
  if(!$gh){
    if($SomenteBaixar){throw 'GitHub CLI não encontrado.'}
    if([Windows.Forms.MessageBox]::Show('O GitHub CLI permite consultar atualizações neste PC. Quer abrir a página de downloads do GitHub?','Atualizações · DECK 26','YesNo','Information') -eq 'Yes'){Start-Process $workflowUrl}
    return
  }
  $releaseJson=& $gh.Source release view --repo $repository --json tagName,isDraft,isPrerelease,assets
  if($LASTEXITCODE -ne 0){throw 'Não foi possível consultar as Releases. Entre no GitHub CLI com uma conta que tenha acesso ao projeto.'}
  $candidate=$releaseJson|Out-String|ConvertFrom-Json
  if($candidate.isDraft -or $candidate.isPrerelease -or $candidate.tagName -notmatch '^v\d+\.\d+\.\d+$' -or
     'DECK26-Instalador.exe' -notin $candidate.assets.name -or 'release.json' -notin $candidate.assets.name){
    throw 'Nenhuma Release estável do DECK 26 foi encontrada.'
  }
  $commit=& $gh.Source api "repos/$repository/commits/$($candidate.tagName)" --jq '.sha'
  if($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$'){throw 'Não foi possível confirmar o commit da Release.'}

  $installed=$null
  $state=Join-Path $ApplicationDirectory 'instalacao.json'
  if(Test-Path -LiteralPath $state){$installed=Get-Content -LiteralPath $state -Raw|ConvertFrom-Json}
  if(!$SomenteBaixar -and $installed.commit -eq $commit){Show-Message 'Você já está usando a versão estável mais recente.';return}
  if(!$SomenteBaixar -and $installed.commit -match '^[a-f0-9]{40}$'){
    $relation=& $gh.Source api "repos/$repository/compare/$($installed.commit)...$commit" --jq '.status'
    if($LASTEXITCODE -ne 0 -or $relation -ne 'ahead'){throw 'Não foi possível confirmar que a Release é sucessora da versão instalada.'}
  }

  $parent=if($DiretorioSaida){(New-Item -ItemType Directory -Force -Path $DiretorioSaida).FullName}else{[IO.Path]::GetTempPath()}
  $download=Join-Path $parent ('deck26-update-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $download | Out-Null
  & $gh.Source release download $candidate.tagName --repo $repository --pattern DECK26-Instalador.exe --pattern release.json --dir $download
  if($LASTEXITCODE -ne 0){throw 'O instalador ainda não está disponível para baixar.'}
  $file=Join-Path $download 'DECK26-Instalador.exe'
  $manifestPath=Join-Path $download 'release.json'
  if(!(Test-Path -LiteralPath $file -PathType Leaf) -or !(Test-Path -LiteralPath $manifestPath -PathType Leaf)){
    throw 'O artefato dessa execução não contém o novo formato de instalador.'
  }
  $release=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
  if($release.repository -ne $repository -or $release.commit -ne $commit -or ("v"+$release.version) -ne $candidate.tagName -or $release.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or
     (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $release.sha256){
    throw 'A versão ou o SHA-256 do instalador baixado não corresponde ao pacote do GitHub.'
  }
  if($release.signed -and (Get-AuthenticodeSignature -LiteralPath $file).Status -ne 'Valid'){throw 'A assinatura digital do instalador é inválida.'}
  if($SomenteBaixar){
    Write-Output ('Instalador verificado: '+$file)
    $download=$null
    return
  }
  $short=$release.commit.Substring(0,7)
  if([Windows.Forms.MessageBox]::Show(('Versão '+$short+' verificada. Quer abrir o instalador? Feche o DECK 26 antes de aplicar a atualização.'),'Atualizações · DECK 26','YesNo','Question') -eq 'Yes'){
    $quote={param($value) '"'+([IO.Path]::GetFullPath($value) -replace '(\\+)$','$1$1')+'"'}
    Start-Process -FilePath $file -ArgumentList ('-ApplicationDirectory '+(& $quote $ApplicationDirectory)+' -DataDirectory '+(& $quote $DataDirectory)) -Wait
  }
}catch{
  if($SomenteBaixar){throw}
  Show-Message $_.Exception.Message
}finally{
  if($download -and (Test-Path -LiteralPath $download)){
    $resolved=(Resolve-Path -LiteralPath $download).Path
    if($resolved -eq [IO.Path]::GetFullPath($download) -and (Split-Path -Leaf $resolved) -match '^deck26-update-[a-f0-9]{32}$'){
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  }
}
