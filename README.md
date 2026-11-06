# DECK 26 · Gestão & Hospitalidade

Restaurante, bar, delivery e Hotel Auto Posto Milla em uma operação local integrada.

[![Validação](https://github.com/Duailibe32/deck26-system/actions/workflows/ci.yml/badge.svg)](https://github.com/Duailibe32/deck26-system/actions/workflows/ci.yml)

![Prévia do painel](docs/images/windows-dashboard.png)

## Instalação operacional local

A versão Windows possui instalação própria, login pessoal e dados persistentes separados da demonstração. O primeiro acesso permite aproveitar os 93 produtos e 24 apartamentos, sem vendas, hóspedes, estoque ou saldos fictícios. O terminal do garçom e o cardápio de pedidos do cliente funcionam pelo navegador na mesma rede, conectados à API do PC na porta 4800.

- [Guia de instalação, uso, celular e backups](docs/OPERACAO_LOCAL.md)
- [Checklist interativo de 66 verificações](docs/CHECKLIST_OPERACIONAL.html)
- [Checklist em texto](docs/CHECKLIST_OPERACIONAL.md)

Impressoras virtuais de caixa e cozinha geram vias de 58/80 mm. Impressão física e emissão fiscal ainda precisam de integração/homologação; a simulação fiscal está bloqueada nesta instalação. Nuvem não configurada. Os registros de PIX/cartão não efetuam cobranças bancárias.

Validação desta entrega: 212 testes automatizados, verificação de tipos e compilação nativa Windows. A conferência usa bancos isolados; a abertura no celular físico depende da rede do estabelecimento.

## PDV touch e atendimento por função

O PDV reúne atendimento, mesas, contas, turno, organização e logs em subabas. Cada cargo inicia na sua visão de trabalho; proprietário/gerente podem alternar para o modo completo, respeitando as permissões. O catálogo possui selos de categoria e estação, busca e favoritos calculados pelo histórico aceito.

O carrinho lateral usa cupom amarelo com quantidades, valores e controles +/−. No pagamento, o teclado grande distingue valor a receber de dinheiro entregue; as cédulas ilustradas somam o dinheiro e exibem o troco. Abrir mesa também permite informar pessoas pelo teclado. No celular estreito, o cupom está na aba Pedido; no tablet largo, fica ao lado dos produtos.

Chamados pelo QR sinalizam a mesa e exigem atendimento da equipe. Transferir consumo ao quarto exige confirmação recente por PIN autorizado, mantém uma identificação para reenvio seguro e envia a mesa à limpeza. O componente de auditoria apresenta ações recentes com operador e horário, disponível à gerência.

Veja o [checklist e roteiro de vídeo do PDV touch](docs/CHECKLIST_PDV_TOUCH.md), incluindo evidências do PDV. A aparência de recibo não habilita emissão fiscal nem impressão física.

## Operação integrada: restaurante, hotel e delivery

As funcionalidades adicionais estão disponíveis em subabas, mantendo a visão de cada cargo:

| Restaurante e caixa | Hotel | Estoque e gestão |
| --- | --- | --- |
| Promoções por dia/horário; escolhas obrigatórias de executivos; baldes com baixa de unidades; couvert separado; refeições da equipe | Calendário com barras; pernoite e day use 4/6 h; café incluso e vouchers; veículos; manutenção com bloqueios | Reposição por fornecedor; margem e sugestão de preço com confirmação; produção/porcionamento; convênios e faturas no Contas a Receber |

O cardápio do cliente abre em **/?delivery=1**, com busca, destaques por horário, personalização, taxa por região e acompanhamento da confirmação. A equipe aceita o pedido antes da baixa de estoque e da produção. O terminal do garçom continua em **/?terminal=garcom**. Os links atuais estão em Administração. O resumo do Turno e a cotação de compras ficam prontos para copiar no WhatsApp; não há envio automático.

- [Checklist completo interativo, com marcações e exportação](docs/CHECKLIST_COMPLETO.html)
- [Roteiro completo de testes e vídeo, com caminhos e pré-requisitos](docs/CHECKLIST_COMPLETO.md)

A previsão de entrega aumenta com a fila e considera a região. Créditos de café, refeições internas e faturamento corporativo mantêm a distinção entre consumo, receita e dinheiro recebido. A migração e o reenvio de operações têm testes de preservação de saldos e de idempotência.

## Preparação fiscal sem certificado A1

O módulo Fiscal agora permite preparar emitentes separados, encaminhar códigos de produtos para revisão e demonstrar aprovação, rejeição, timeout com consulta e offline em um simulador local. No caixa, a conferência integral não recebe pagamentos nem encerra a comanda. Os ensaios ficam em tabela própria, não consomem numeração e não geram chave, protocolo ou QR fiscal.

**Motor de emissão real ainda não implementado:** A1/cofre criptográfico, XMLDSig, XML/XSD, SOAP/mTLS, QR fiscal, DANFE oficial, eventos e contingência oficial permanecem pendentes. Escolher Produção futura não habilita transmissão.

Use o [checklist e roteiro de vídeo](docs/CHECKLIST_VIDEO_FISCAL.md) ou a [versão interativa](docs/CHECKLIST_VIDEO_FISCAL.html). A apresentação usa banco separado, somente no PC, porta 4802. Inicie com npm run start:fiscal:presentation; PIN de exemplo 536821, exclusivo desta instalação. A preparação não cria uma regra de dispensa de emissão por tipo de alimento, CPF ou forma de pagamento.

## Estado do projeto

Etapa 7A revisada antes da 7B. A interface Windows usa a API operacional local. A prévia web é uma demonstração separada, com dados fictícios guardados somente no navegador. Nenhum serviço foi publicado online por esta revisão.

A revisão corrige falhas de inicialização, autenticação, autorização, pagamentos, custódia de entregadores e atomicidade do PMS. Os testes automatizados não substituem a conferência do histórico financeiro, a homologação fiscal e a validação de impressoras e do instalador Windows.

## Experiência de uso

- Paleta: rosa #F72585, preto #111111, roxo #7209B7 e cinza #1A1A1A; fonte Plus Jakarta Sans e marca fornecida pelo proprietário.
- Botões com hierarquia visual, foco de teclado, estados de interação e áreas de toque maiores.
- Windows Desktop: mesas verdes livres, amarelas ocupadas e vermelhas aguardando pagamento; limpeza azul e indisponibilidade cinza. Textos e símbolos acompanham as cores.
- Dashboard Recharts responsivo: vendas dos últimos sete dias e distribuição atual dos apartamentos. No Windows, vendas são receita bruta reconhecida na DRE, não saldo bancário; os dias seguem UTC. A prévia web identifica seus recebimentos como fictícios.
- Prévia interativa: catálogo com busca, comandas por mesa, pagamento parcial, transferência ao quarto, hospedagem, delivery, financeiro e documentos de exemplo sem validade fiscal.

## Estrutura

| Pasta | Responsabilidade |
|---|---|
| apps/desktop | Interface operacional React/Vite, preparada para Tauri 2 |
| apps/local-server | API Fastify e SQLite da operação |
| apps/cloud-api | Simulador de nuvem SQLite com sincronização autenticada |
| apps/web | Demonstração comercial independente |
| packages/contracts | Contratos Zod e regras compartilhadas |
| packages/ui | Identidade visual, botões e gráficos compartilhados |

PostgreSQL, emissão SEFAZ/prefeitura e sincronização completa entre todos os módulos ainda não estão implementados. Configurar DATABASE_URL não ativa PostgreSQL.

## Começar no Windows

Requer Node.js 22.13 ou superior e npm. Na raiz do repositório:

```powershell
npm ci
Copy-Item .env.example .env
```

Preencha .env antes de iniciar os servidores:

- DECK26_AUTH_SECRET e DECK26_QR_SEED_SECRET: valores aleatórios fortes e distintos.
- DECK26_SYNC_SECRET: segredo compartilhado pelos dois servidores.
- DECK26_BOOTSTRAP_PIN: PIN próprio de 6 a 12 dígitos para criar o proprietário; remova a variável após o primeiro uso.
- DECK26_DEMO_MODE=false: bancos novos começam sem hóspedes, estoque, receitas, saldos fictícios ou usuários de exemplo. Cadastre e confira os dados reais antes da operação.

Uma forma de gerar cada segredo é executar localmente: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))". Não compartilhe os valores nem versione .env.

```powershell
npm run dev:all
```

| Acesso local | Endereço |
|---|---|
| Windows Desktop no navegador | http://localhost:5173 |
| Prévia comercial fictícia | http://localhost:5174 |
| Saúde da API local | http://127.0.0.1:4000/api/health |
| Saúde do simulador cloud | http://127.0.0.1:4100/api/health |

Para conhecer somente o visual: npm run dev:web. Para testar a operação com exemplos, use DECK26_DEMO_MODE=true e **um caminho de banco descartável**, nunca o banco operacional. Os PINs de exemplo são recusados em produção. As APIs carregam o .env da raiz automaticamente pelos scripts npm. Os bancos relativos são resolvidos a partir do diretório de cada aplicativo; prefira caminhos absolutos ao configurar um ambiente real.

## Verificar

```powershell
npm run typecheck
npm test
npm run build
npm audit --audit-level=moderate
```

A validação local de 05/11/2026 executou 140 testes, inicialização real das duas APIs pelo Node, verificação de tipos e compilação das interfaces. A instalação revisada reportou zero vulnerabilidades conhecidas. O selo do GitHub mostra o resultado da validação remota do commit publicado.

O build não gera um instalador Tauri. O empacotamento Windows exige Rust, WebView2 e ferramentas C++; hardware e emissão fiscal precisam de validação própria.

## Aplicativo Windows nativo para teste

A tela de login bloqueia os módulos até autenticação por PIN. O ambiente nativo de teste usa API local e SQLite persistente separado, sem cobranças ou documentos fiscais reais. Consulte [como gerar, abrir e testar](docs/WINDOWS_TEST.md).

Execute npm run build:windows:test no Windows com Rust/MSVC instalados; o script scripts/install-windows-test-shortcut.ps1 cria o atalho que inicia API e janela nativa juntos. O executável não incorpora a API nem substitui a homologação operacional.

## Segurança, financeiro e preparação da 7B

Leia [revisão e evidências](docs/REVISAO_PRE_7B.md), [segurança](docs/SECURITY.md), [invariantes financeiras](docs/FINANCIAL_INVARIANTS.md), [testes](docs/TESTING.md) e [checklist de produção](docs/PREPRODUCTION_CHECKLIST.md).

Antes de aplicar a nova versão a um banco existente, faça backup consistente e ensaie a migração em uma cópia. A revisão não reconstrói movimentos históricos ausentes: concilie saldos de caixa, banco, cartões e carteira de entregadores com extratos e registros reais. Consulte [backup e recuperação](docs/BACKUP_AND_RECOVERY.md).

Não publique a API operacional nem o servidor de desenvolvimento Vite na internet. A 7B deve configurar HTTPS, origem autorizada, cópias de segurança e monitoramento, além de validar o ambiente de hospedagem. O simulador cloud não equivale a uma implantação homologada.
