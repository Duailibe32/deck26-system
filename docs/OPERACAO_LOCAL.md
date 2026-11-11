# Operação local no Windows

A instalação operacional mantém dados reais em `%USERPROFILE%\Deck26\DadosOperacionais`, fora do repositório, do OneDrive e do banco de demonstração. Não há PIN padrão. A API usa a porta 4800; o aplicativo de testes continua separado na porta 4700.

## Instalar pelo pacote do GitHub

Baixe **DECK26-Instalador.exe** em [GitHub Releases](https://github.com/Duailibe32/deck26-system/releases/latest). Execute o assistente no Windows x64 com internet disponível. O Node.js e o npm ficam na pasta privada de cada versão. O assistente instala as dependências do aplicativo e baixa o WebView2 oficial se o Windows ainda precisar dele. Confira as pastas no assistente e depois abra **DECK 26 - Operacao Local** na área de trabalho.

Para atualizar um computador que já atende clientes, feche o sistema. Quando encontra a base na pasta indicada, o instalador cria e verifica um backup antes de trocar os atalhos. Para consultar versões pelo GitHub, use **Iniciar → DECK 26 → Verificar atualizações** com o GitHub CLI autenticado em uma conta com acesso ao projeto privado. A versão anterior permanece na pasta `versoes`. Se precisar voltar, valide o backup antes de abrir uma versão anterior sobre dados atualizados.

O painel **Administração → Acesso e continuidade** mostra os endereços do garçom e do cliente, a versão instalada, os backups e o último ensaio de restauração. Os botões de caixa e cozinha abrem prévias do simulador térmico.

## Publicar uma Release

1. Atualize a versão em `package.json` e no lockfile. Valide o commit com o CI e a compilação Windows.
2. Confira se o manifesto e o executável correspondem ao commit. Teste a instalação em uma pasta e um banco separados.
3. Crie uma Release estável com uma tag `vMAJOR.MINOR.PATCH` correspondente à versão do manifesto. Anexe `DECK26-Instalador.exe` e `release.json` e registre os requisitos nas notas.
4. Para assinar o instalador, configure `DECK26_SIGNTOOL` com o caminho do SignTool e `DECK26_SIGNING_THUMBPRINT` com o identificador de um certificado Authenticode confiável no repositório de certificados do usuário que compila. O SHA-256 é calculado após a assinatura. Distribua uma versão sem certificado com o status de assinatura indicado nas notas.

## Primeiro acesso

1. Abra **DECK 26 - Operacao Local** na área de trabalho.
2. No computador principal, informe seu nome e crie seu PIN pessoal de 6 a 12 dígitos. Confirme a importação do cardápio e dos 24 apartamentos.
3. Entre com seu PIN. Em **Funcionários**, cadastre os operadores com cargos e PINs individuais.
4. Revise os 93 produtos, preços por canal, disponibilidade, receitas e estoque. O estoque começa zerado; faça o inventário antes das vendas.
5. Revise tarifas, características e situação dos 24 apartamentos. Há unidades em construção, que não devem ser colocadas à venda sem revisão.
6. Abra o caixa com o fundo verdadeiro e confira contas financeiras antes de lançar recebimentos. Hóspedes, vendas, caixa e saldos começam vazios.

## Celular do garçom

PC e celular precisam estar na mesma rede local, sem isolamento de clientes Wi-Fi. Abra o link exibido em **Administração → Acesso e continuidade**, com `/?terminal=garcom`. Entre com o PIN do garçom. É possível abrir mesa, lançar itens e observações, aprovar pedidos QR, confirmar entrega e solicitar conta. Os pedidos são gravados no PC e chegam à produção.

O PC deve permanecer ligado e sem suspensão. Fechar a janela nativa pelo atalho encerra o servidor que o atalho iniciou. Também existe **Encerrar servidor local** na Administração. Desligar o servidor interrompe os celulares e preserva os lançamentos já confirmados. Se houver falha durante um envio, use **Reenviar com segurança**: a identificação do pedido evita duplicação.

A regra de firewall permite somente TCP 4800 do Node.js, no IPv4 privado do PC e para a sub-rede local autorizada. Não abre portas do roteador. O acesso é HTTP local com login, sem criptografia de transporte: use rede confiável de operação, separada do Wi-Fi de visitantes. Pessoas na mesma rede conseguem chegar ao login. Não publique esse endereço na internet. Se o IP do PC mudar, atualize o endereço e a regra restrita; prefira reserva DHCP no roteador.

Os links por mesa estão em **Garçons (Wi-Fi)**. QR de cliente apresenta somente o cardápio público; os pedidos exigem aprovação por padrão e só entram na conta após aprovação.

## Caixa e cozinha: impressão térmica

Em **Impressoras**, existem modelos de produção, pré-conta, recibo de pagamento e fechamento. Em **Administração**, selecione bobinas de 58 ou 80 mm para caixa e cozinha. Para destinos em simulação, o aplicativo grava as vias HTML em `impressoes-simuladas`. Exemplos independentes ficam em `modelos-de-impressao` (quatro modelos, duas larguras).

Abra as vias simuladas pelo painel ou pelo arquivo HTML para conferir o modelo. Para usar uma impressora térmica ESC/POS em USB ou rede, instale a fila do fabricante no Windows e confira o nome em **Impressoras e scanners**. Feche o aplicativo e crie `impressoras-windows.json` na pasta dos dados operacionais:

```json
{
  "PRINTER_CASHIER": "Nome da fila térmica do caixa",
  "PRINTER_KITCHEN": "Nome da fila térmica da cozinha"
}
```

Abra o aplicativo novamente. A fila da cozinha recebe as vias de cozinha quente, fria, chapa e bar. Se houver filas separadas, informe `PRINTER_KITCHEN_HOT`, `PRINTER_KITCHEN_COLD`, `PRINTER_GRIDDLE` ou `PRINTER_BAR` no mesmo arquivo. Destinos sem configuração física usam o simulador. Na primeira ativação, vias antigas só entram na impressão física se uma nova cópia for autorizada.

Em **Impressoras → Falhas**, consulte o motivo. Se o Windows recebeu a via e informar falta de papel ou pausa, corrija o equipamento e aguarde a mesma via. Se houve recusa antes da entrega, use **Reenviar a mesma via**. Se o resultado for desconhecido, confira a fila do Windows e o papel antes de confirmar a saída ou autorizar a segunda via. Valide com um pedido fictício, teste sem papel e confira a recuperação antes de usar em atendimento.

## Inventário pelo celular

Na mesma rede, abra o endereço local do computador principal com `/?terminal=estoque` e entre com um PIN autorizado para estoque. Informe o local, busque por nome, SKU ou código de barras e registre a quantidade de cada prateleira. Confira todos os locais de cada produto incluído, revise as divergências e confirme. O inventário é aplicado em uma transação, e o sistema pede nova contagem se alguma venda ou movimentação alterar o saldo durante a conferência.

## Backup e continuidade

**Administração → Criar backup agora** gera uma cópia consistente de SQLite. Há também backup diário ao iniciar (e conferência a cada hora) e no encerramento normal. Os arquivos ficam em `backups`. Copie backups e `segredos-locais.json` para um local seguro fora do PC; os backups locais não protegem contra perda do computador. Nunca compartilhe o arquivo de segredos ou o banco.

Para restaurar, encerre o servidor e confirme que a porta 4800 está desligada, preserve a pasta inteira atual com outro nome e restaure um backup para `deck26-operacao.sqlite` numa pasta limpa junto do arquivo original de segredos. Não substitua somente o SQLite com o servidor ligado e não reutilize arquivos WAL/SHM antigos. Confira integridade e saldos antes de voltar a atender. A restauração de backup foi validada em ambiente isolado; não foi feita sobre seus dados.

## Escopo e limites

Pedidos, comandas, caixa, estoque, PMS, delivery e financeiro fazem lançamentos locais persistentes. Registros de PIX/cartão e conciliação são controles internos: não cobram automaticamente no banco ou na adquirente. O cliente faz pedidos pelo link local /?delivery=1. A equipe confere e aceita antes da produção. Não há integração automática com plataformas externas.

**Emissão fiscal SEFAZ/prefeitura não está habilitada**, e a simulação fiscal está bloqueada na instalação operacional. Comprovantes internos não substituem documentos fiscais exigíveis. Nuvem e sincronização completa não estão configuradas. Não há certificação de uso operacional ou homologação fiscal/hardware implícita nos testes automatizados.

## Conferência guiada

Abra [CHECKLIST_OPERACIONAL.html](CHECKLIST_OPERACIONAL.html): 66 verificações manuais, com status, observações, exportação JSON e impressão/PDF. As marcações ficam no navegador; exporte para guardar. O checklist não altera os dados de negócio. Faça sua conferência em uma instalação separada antes de registrar operações de clientes reais.

## Recompilar e instalar

Requisitos: Windows, Node.js 22.13+, Rust estável, MSVC Build Tools e WebView2. Na raiz:

```powershell
npm ci
npm test
npm run typecheck
npm run build:windows:local
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-operation.ps1
```

O script de desenvolvimento copia o executável e a interface para `%USERPROFILE%\Deck26\Aplicativo`, cria o atalho e copia o checklist. O servidor iniciado por esse atalho usa o código e as dependências do repositório. Para gerar o pacote de distribuição após o build operacional, use `scripts/package-windows.ps1 -OutputDirectory ..\Entregas-DECK26`.

## Rotinas integradas e checklist completo

Consulte [CHECKLIST_COMPLETO.md](CHECKLIST_COMPLETO.md) e [CHECKLIST_COMPLETO.html](CHECKLIST_COMPLETO.html) para as novas subabas de recepção, restaurante, estoque e delivery, os cadastros necessários e o roteiro de vídeo. No celular, use o link atual do cliente em Administração; o servidor precisa permanecer ligado.
