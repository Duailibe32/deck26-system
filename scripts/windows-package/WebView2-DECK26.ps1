function Get-Deck26WebView2Version {
  $client = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  foreach ($root in @('HKLM:\SOFTWARE\WOW6432Node', 'HKLM:\SOFTWARE', 'HKCU:\Software')) {
    $version = (Get-ItemProperty -LiteralPath "$root\Microsoft\EdgeUpdate\Clients\$client" -Name pv -ErrorAction SilentlyContinue).pv
    if ($version -as [version] -and [version]$version -gt [version]'0.0.0.0') { return $version }
  }
}

function Install-Deck26WebView2 {
  $version = Get-Deck26WebView2Version
  if ($version) {
    Write-Output "WebView2 $version já disponível."
    return
  }

  Write-Output 'Baixando o WebView2 da Microsoft...'
  $bootstrapper = Join-Path $PSScriptRoot 'MicrosoftEdgeWebView2Setup.exe'
  try {
    Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrapper
    $signature = Get-AuthenticodeSignature -LiteralPath $bootstrapper
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.GetNameInfo('SimpleName', $false) -ne 'Microsoft Corporation') {
      throw 'A assinatura do instalador do WebView2 não pôde ser verificada.'
    }
    $process = Start-Process -FilePath $bootstrapper -ArgumentList '/silent /install' -WindowStyle Hidden -PassThru -Wait
    $version = Get-Deck26WebView2Version
    if (!$version) { throw "O WebView2 não ficou disponível (código $($process.ExitCode))." }
    Write-Output "WebView2 $version disponível."
  } finally {
    if (Test-Path -LiteralPath $bootstrapper) { Remove-Item -LiteralPath $bootstrapper -Force }
  }
}
