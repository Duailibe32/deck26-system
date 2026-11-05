# Operação local no Windows

A instalação operacional mantém dados reais em `%USERPROFILE%\Deck26\DadosOperacionais`, fora do repositório, do OneDrive e do banco de demonstração. Não há PIN padrão. A API usa a porta 4800; o aplicativo de testes continua separado na porta 4700.

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

## Caixa e cozinha: simulação térmica

Em **Impressoras**, existem modelos de produção, pré-conta, recibo de pagamento e fechamento. Em **Administração**, selecione bobinas de 58 ou 80 mm para caixa e cozinha. A cada trabalho de impressão, o simulador grava uma via HTML em `impressoes-simuladas`. Exemplos independentes ficam em `modelos-de-impressao` (quatro modelos, duas larguras).

Abra as vias pelo painel ou pelo arquivo HTML e use o navegador para imprimir/salvar em PDF. As vias estão identificadas como simulação, sem validade fiscal e sem equipamento acionado. O sistema não marca uma simulação como impressão física concluída. A autorização de segunda via é auditada. A integração física USB/rede e a homologação do equipamento ainda precisam ser feitas quando houver as impressoras.

## Backup e continuidade

**Administração → Criar backup agora** gera uma cópia consistente de SQLite. Há também backup diário ao iniciar (e conferência a cada hora) e no encerramento normal. Os arquivos ficam em `backups`. Copie backups e `segredos-locais.json` para um local seguro fora do PC; os backups locais não protegem contra perda do computador. Nunca compartilhe o arquivo de segredos ou o banco.

Para restaurar, encerre o servidor e confirme que a porta 4800 está desligada, preserve a pasta inteira atual com outro nome e restaure um backup para `deck26-operacao.sqlite` numa pasta limpa junto do arquivo original de segredos. Não substitua somente o SQLite com o servidor ligado e não reutilize arquivos WAL/SHM antigos. Confira integridade e saldos antes de voltar a atender. A restauração de backup foi validada em ambiente isolado; não foi feita sobre seus dados.

## Escopo e limites

Pedidos, comandas, caixa, estoque, PMS, delivery e financeiro fazem lançamentos locais persistentes. Registros de PIX/cartão e conciliação são controles internos: não cobram automaticamente no banco ou na adquirente. Delivery é operação interna, sem integração automática com plataformas externas.

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

O instalador copia o executável e a interface para `%USERPROFILE%\Deck26\Aplicativo`, cria o atalho e copia o checklist. O servidor utiliza o código e as dependências do repositório; mantenha a pasta no mesmo local. Ainda não é um instalador autossuficiente para outros computadores. Nenhum dado operacional é sobrescrito na atualização do aplicativo.
