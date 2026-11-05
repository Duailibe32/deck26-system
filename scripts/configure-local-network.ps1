param(
  [Parameter(Mandatory=$true)][string]$LocalAddress,
  [Parameter(Mandatory=$true)][string]$Subnet
)
$ErrorActionPreference = 'Stop'
$ip = [System.Net.IPAddress]::Parse($LocalAddress)
if ($ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or $LocalAddress -notmatch '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)') { throw 'Informe o IPv4 privado da rede local.' }
if ($Subnet -notmatch '^([0-9]{1,3}\.){3}[0-9]{1,3}/(1[6-9]|2[0-9]|3[0-2])$') { throw 'Informe a sub-rede local em CIDR.' }
$node = (Get-Command node -ErrorAction Stop).Source
$name = 'Deck26-Operacao-Local-4800'
$existing = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
if ($existing) { throw 'Já existe uma regra DECK 26. Confira os filtros antes de alterá-la manualmente.' }
New-NetFirewallRule -Name $name -DisplayName 'DECK 26 - Operacao local Wi-Fi' -Description 'Somente porta 4800, Node.js, IPv4 privado do PC e sub-rede local autorizada. Sem abertura de internet.' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4800 -LocalAddress $LocalAddress -RemoteAddress $Subnet -Program $node -Profile Any -EdgeTraversalPolicy Block -ErrorAction Stop | Out-Null
Write-Output ('Garçom: http://'+$LocalAddress+':4800/?terminal=garcom')
Write-Output ('Acesso restrito à sub-rede '+$Subnet+'. O servidor precisa estar ligado.')
