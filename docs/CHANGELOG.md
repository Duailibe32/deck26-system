# Changelog — DECK 26

Todas as mudanças relevantes do projeto **DECK 26** são documentadas neste arquivo.

## [Etapa 7A] - 2026-11-05
### Adicionado & Aprimorado
- **Demonstração Online Comercial Mobile-First (`apps/web`)**:
  - Aplicação web interativa responsiva voltada para apresentação comercial a clientes e investidores pelo celular;
  - Tarja de destaque visual permanente no topo: `✨ MODO DEMONSTRAÇÃO COMERCIAL — DECK 26 & HOTEL AUTO POSTO MILLA (DADOS SIMULADOS)`;
  - 7 módulos navegáveis: Visão Geral (KPIs e cards de status), Cardápio Digital (93 itens oficiais com busca em tempo real e filtro por categoria), Mesas & Salão (visão gráfica de salão), Hotel PMS (grid dos 24 apartamentos com status detalhado), Delivery Próprio (gestão de rotas, taxas e despacho de motoboy), DRE & Caixa (demonstrativo gerencial e controle de caixa) e Simulador Fiscal (emissão de NFC-e / NFS-e com chave simulada e aviso legal);
  - Modo autônomo com zero backend: quando o servidor local ou API de nuvem não estão conectados, a aplicação utiliza dados em memória gerados a partir dos contratos oficiais (`stage7a_catalog.ts`), garantindo demonstração ininterrupta.
- **Hotel Auto Posto Milla — Expansão para 24 Apartamentos**:
  - Suporte ao inventário completo de 24 quartos: 12 operacionais ativos (Aptos 101 a 112) e 12 em construção civil (Aptos 201 a 212);
  - Novo campo `commercial_status` (`OPERACIONAL`, `EM_CONSTRUCAO`, `DESATIVADO`) e colunas `name` e `photos` em `hotel_rooms`;
  - Trava operacional estrita no backend: quartos com `commercialStatus === 'EM_CONSTRUCAO'` rejeitam reservas, check-ins diretos e lançamento de diárias (retorna `HTTP 400`);
  - Exclusão matemática estrita de quartos em obras do denominador de cálculo da Taxa de Ocupação % e RevPAR (evitando diluição artificial das métricas reais);
  - Interface desktop (`apps/desktop`) aprimorada com badges visuais de obras (`🚧 EM OBRAS`), botões de reserva/check-in desabilitados com tooltip explicativo, filtros de visualização (`Todos`, `Operacionais`, `Em Obras`, `Livres`, etc.) e assistente modal para edição rápida de atributos, categoria, diária e transição de status de obras.
- **Cardápio Oficial DECK 26 — 93 Produtos e 10 Categorias**:
  - Catalogação completa dos 93 produtos oficiais com SKUs estruturados, estações de preparo (Cozinha Quente, Cozinha Fria, Chapa, Bar/Bebidas), preços por canal comercial e metadados fiscais (NCM, CFOP, CSOSN);
  - Distribuição exata por categorias: Pratos Executivos (11), Tapiocas (7), Para Qualquer Hora (7), Cuscuz Recheado (7), Pastéis (8), Lanches (9), Petiscos (21), Cafeteria (7), Sucos 300ml (9) e Vitaminas 300ml (7);
  - Identificação e catalogação formal da pendência de nomenclatura do item `D26-CZ-005` ("Cuscuz de carne de sol sem catupiry", com flag `verificationPending: true`);
  - Seeding idempotente que convive harmoniosamente com produtos de testes anteriores sem quebrar retrocompatibilidade.
- **Módulo Fiscal Preparatório & Multi-Estabelecimento**:
  - Segregação de pessoas jurídicas: Restaurante Deck 26 (CNPJ Matriz `12345678000190`, Inscrição Estadual, regime Simples Nacional, documento NFC-e Mod 65) vs Hotel Auto Posto Milla (CNPJ Filial `12345678000271`, Inscrição Municipal, regime Simples Nacional, documento NFS-e Municipal);
  - Distinção conceitual e técnica dos documentos: Comanda Operacional, Pré-Conta conferencial (sem valor fiscal), Comprovante de Pagamento (POS/TEF) e Documento Fiscal eletrônico;
  - Endpoint de emissão conferencial `POST /api/tabs/:id/pre-conta` (gera spooler com cabeçalho CONFERÊNCIA DE MESA - NÃO É DOCUMENTO FISCAL);
  - Motor de simulação fiscal `POST /api/fiscal/simulate` com geração determinística de chave de acesso de 44 dígitos (ano, mês, CNPJ, mod, série, nNF, cNF, cDV) e tarja "SEM VALIDADE FISCAL - DEMO";
  - Rejeição e bloqueio de mecanismos arbitrários de sonegação fiscal ("modo sem nota");
  - Endpoints de listagem, consulta e cancelamento simulado de documentos fiscais;
  - Documentação em `docs/FISCAL_SPEC.md`, `docs/HOTEL_24_ROOMS.md`, `docs/MENU_93_PRODUCTS.md` e `docs/DEMO_ARCHITECTURE.md`.
- **Testes & Qualidade**:
  - 16 novos testes automatizados: 3 testes de invariantes em `packages/contracts/src/contracts.test.ts` e 13 testes de integração em `apps/local-server/src/stage7a.test.ts`;
  - Total de testes automatizados elevado para **119 testes aprovados (100% de sucesso)**;
  - Typecheck limpo com 0 erros em todos os 6 pacotes do monorepositório.

## [Etapa 6.5] - 2026-11-05
### Corrigido & Aprimorado
- **Correção de Flakiness de Datas nos Testes**:
  - Eliminação de datas hardcoded em testes hoteleiros e DRE (`hotel.test.ts` e `stage6.test.ts`), substituindo por datas dinâmicas relativas a `new Date()` e garantindo que o conjunto de testes execute sem falhas independentemente do dia e fuso horário.
- **Rigor Contábil da DRE Gerencial**:
  - Correção na query de receita bruta hoteleira em `generateDreStatement` e no dashboard executivo: agora filtra explicitamente débitos operacionais positivos (`amount_cents > 0` e `entry_type IN ('ROOM_RATE', 'MINIBAR', 'SERVICE', 'ADJUSTMENT')`), impedindo que lançamentos de `PAYMENT` ou adiantamentos negativos reduzam indevidamente a receita de diárias.
  - Correção do tratamento de nulos no SQL para `source_reference_type != 'TAB'` com `(source_reference_type IS NULL OR source_reference_type != 'TAB')`, blindando contra a lógica trivalente de nulos no SQLite.
  - Base de cálculo de competência em `tabs` aprimorada para `date(COALESCE(closed_at, opened_at))`.
- **Segurança de Endpoints & RBAC**:
  - Endpoints executivos de DRE (`/api/finance/dre`), Fluxo de Caixa (`/api/finance/cash-flow/*`) e Dashboard (`/api/finance/dashboard`) agora exigem autorização explícita `finance:view_dre`, retornando `403 Forbidden` para garçons e operadores de cozinha.
  - Ativação automática de `requireStrictAuth` quando `NODE_ENV === 'production'` ou `DECK26_STRICT_AUTH === 'true'`.
- **Gestão Segura de Contas Bancárias**:
  - Disponibilizado e testado o endpoint `PUT /api/finance/accounts/:id`, permitindo renomear, configurar chaves PIX e desativar contas financeiras demonstrativas (ex.: Banco do Brasil, Bradesco) sem exclusão física e sem quebra de integridade referencial.
- **Nova Suíte de Testes de Homologação**:
  - Criação do arquivo `apps/local-server/src/stage6_5_audit.test.ts` com 8 testes cobrindo aritmética em centavos exatos, invariantes de caixa (sangria/suprimento), isolamento contábil de `ROOM_CHARGE`, prestação de contas de delivery e bloqueios RBAC.
  - Total de testes automatizados elevado para **103 aprovados com 100% de sucesso**.
- **Nova Documentação Técnica**:
  - `docs/AUDIT_STAGE_6_5.md`: Relatório completo da auditoria geral.
  - `docs/FINANCIAL_INVARIANTS.md`: Manual contábil e matemática financeira do sistema.
  - `docs/OPERATIONAL_ACCEPTANCE.md`: Matriz de homologação e critérios de aceitação.
  - `docs/PREPRODUCTION_CHECKLIST.md`: Checklist de prontidão para produção e requisitos Windows.
  - `docs/BACKUP_AND_RECOVERY.md`: Runbook oficial de backup atômico (`VACUUM INTO`) e recuperação de desastres.

## [Etapa 6] - 2026-11-04
### Adicionado
- **Delivery Próprio & Central de Despacho**:
  - Tabela de regiões e bairros (`delivery_zones`) com taxas fixas em BRL e tempo estimado sem necessidade de APIs pagas de mapas.
  - Ciclo transacional completo de pedidos delivery (`NOVO` -> `CONFIRMADO` -> `EM_PREPARO` -> `PRONTO` -> `SAIU_PARA_ENTREGA` -> `ENTREGUE`).
  - Recálculo seguro no backend de subtotais, taxas e valores finais sem confiar em dados enviados pelo frontend.
  - Cadastro de motoboys (`delivery_couriers`) com taxa por entrega e trava de disponibilidade.
  - Despacho de pedidos prontos com atribuição a entregador disponível.
  - Prestação de contas (acerto) de motoboys com transferência de custódia para o Caixa Geral da tesouraria, pagamento de taxas de entrega e recibo de liquidação.
  - Base de clientes de delivery (`delivery_customers`) com suporte a múltiplos endereços de entrega.
- **Gestão Financeira Integrada & Tesouraria Multi-Contas**:
  - Plano de contas gerencial (`financial_categories`) dividido em naturezas contábeis: Receitas, Deduções, Custos Diretos/CMV, Despesas Operacionais e Resultado Financeiro.
  - Centros de custo (`cost_centers`): Restaurante (`REST`), Bar (`BAR`), Delivery (`DELIV`), Hotel (`HOTEL`), Administração (`ADMIN`).
  - Gestão de contas financeiras (`financial_accounts`): Caixa Geral do PDV, Cofre da Sede, Contas Bancárias (Banco do Brasil, Bradesco) e Carteira temporária de motoboys.
  - Contas a pagar (`accounts_payable`) com suporte a liquidação parcial/total multi-meio e débito direto na conta de tesouraria escolhida.
  - Contas a receber (`accounts_receivable`) com baixa no caixa.
  - Cadastro de fornecedores de insumos (`suppliers`).
  - Registro de compras faturadas com Nota Fiscal (`purchase_invoices`): entrada de mercadorias no Kardex como Ativo Circulante e geração de obrigação no Contas a Pagar.
  - Transferências internas entre contas financeiras (`financial_transfers`): sangrias de segurança do PDV para o cofre e depósitos bancários sem alteração de receita contábil.
  - Conciliação manual de contas (`account_reconciliations`) com confronto de saldos contábeis e extratos reais/contagem física.
- **DRE Gerencial por Competência & Invariantes Contábeis**:
  - Cálculo estrito do Demonstrativo de Resultado por Competência discriminado por canais e centros de custo.
  - Invariante 1: Transferências `ROOM_CHARGE` (consumo de restaurante transferido para conta de quarto de hotel) não duplicam faturamento no DRE.
  - Invariante 2: A compra de estoque é debitada no Ativo Circulante; o CMV ocorre estritamente na venda ou no consumo por ficha técnica aprovada.
  - Invariante 3: Prestação de contas de motoboys e transferências internas são movimentações de custódia de liquidez sem efeito econômico no DRE.
  - Projeção de Fluxo de Caixa: Realizado (regime de caixa por meio de pagamento) e Previsto (projeção diária por vencimento para os próximos 30 dias).
- **Relatórios Comerciais & Mitigação contra CSV Formula Injection**:
  - Exportação CSV segura para DRE, Vendas por Produto, Contas a Pagar e Contas a Receber.
  - Sanitização nativa via `sanitizeCsvCell()` com prefixo apóstrofo (`'`) para células iniciadas em `=`, `+`, `-`, `@`, `\t`, `\r` (proteção CWE-1236).
- **Interface & Testes Automatizados**:
  - Módulos desktop completos: `DeliveryModule.tsx`, `FinanceModule.tsx` e `ReportsModule.tsx`.
  - Migrações SQL `0005_stage6_delivery_and_finance.sql` (SQLite 3 WAL) e `0005_stage6_cloud_delivery_and_finance.sql` (PostgreSQL 16+).
  - 24 novos testes automatizados em `apps/local-server/src/stage6.test.ts` incluindo teste de ponta a ponta operacional integrado de 28 passos.
  - Total de 95 testes automatizados aprovados no monorepositório com 100% de sucesso.

## [Etapa 5] - 2026-11-04
### Adicionado
- Módulo Hoteleiro PMS Completo para o Hotel Auto Posto Milla integrado nativamente ao Deck 26.
- Gestão de apartamentos com triplo status ortogonal e independente: Ocupação (`LIVRE`, `RESERVADO`, `OCUPADO`, `BLOQUEADO`), Governança (`LIMPO`, `SUJO`, `EM_LIMPEZA`, `INSPECAO_PENDENTE`) e Manutenção (`DISPONIVEL`, `EM_MANUTENCAO`, `INTERDITADO`).
- Desativação lógica obrigatória de apartamentos quando houver histórico de estadias passadas, preservando a integridade das auditorias.
- Cadastro e busca de hóspedes com LGPD, CPF/Passaporte, telefone e placa do veículo para o estacionamento do Auto Posto Milla.
- Motor de reservas com cálculo exato de diárias em centavos inteiros (`calculateNightsCount`) e validação estrita contra sobreposição de intervalo de datas `[in, out)`.
- Check-in guiado (walk-in e com reserva), geração de comanda Folio (`APTO-XXX`), lançamento da 1ª diária e suporte a early check-in.
- Razão contábil do quarto (Hotel Folio Ledger) com lançamentos cronológicos de débitos e créditos.
- Integração transacional Deck 26 Restaurante -> Folio Quarto via método de pagamento `ROOM_CHARGE`, liberando a mesa no salão sem duplicar baixas de insumos no estoque e sem inflar o caixa do restaurante.
- Frigobar por apartamento com débito automático no folio e baixa de estoque do almoxarifado.
- Serviços adicionais de hotelaria (lavanderia expressa, cama extra, café da manhã adicional, estacionamento).
- Check-out obrigatório com saldo zerado, bloqueio contra saídas com débito em aberto e opção de liberação especial documentada no log de auditoria.
- Painel operacional de camareiras/governança com avanço de estados e chamados de manutenção predial com interdição.
- Painel de métricas hoteleiras em tempo real: ADR (Diária Média), RevPAR, Taxa de Ocupação %, Receitas Recebidas e Saldos Pendentes.
- Migrações SQL `0004_stage5_hotel_pms.sql` (local SQLite) e `0004_stage5_cloud_hotel_pms.sql` (PostgreSQL 16+ na nuvem).
- 36 novos testes automatizados em `apps/local-server/src/hotel.test.ts`, totalizando 71 testes aprovados em 100%.

## [Etapa 4.5] - 2026-11-04
### Adicionado
- Documentação técnica completa em português (`README.md` e pasta `docs/`).
- Pipeline de validação contínua no GitHub Actions (`.github/workflows/ci.yml`) executando `npm run typecheck`, `npm test` e `npm run build`.
- Geração de chave HMAC efêmera por processo em desenvolvimento quando `DECK26_AUTH_SECRET` não estiver definido e validação estrita em produção.

## [Etapa 4] - 2026-11-04
### Adicionado
- Gestão visual e transacional de mesas com distinção entre estado físico e estado financeiro.
- Proteção contra abertura duplicada concorrente da mesma mesa (`idx_tabs_unique_active_table` + `BEGIN IMMEDIATE TRANSACTION`).
- Transferência de mesas, junção/separação de mesas e transferência de itens entre comandas sem nova baixa de estoque nem reimpressão.
- Divisão de contas (`FREE_AMOUNT`, `EQUAL_SHARES`, `BY_ITEMS`, `MIXED`), descontos autorizados, taxa de serviço configurável, cálculo de troco em espécie e estorno de pagamentos.
- KDS com SLA configurável, notificações em tempo real via Server-Sent Events (`/api/events/stream`), cancelamento por estágio (`BEFORE_PREP`, `DURING_PREP`, `AFTER_DELIVERY`) e proteção de spooler térmico (`UNKNOWN_OUTCOME` + 2ª via).
- Ciclo completo de turno de caixa (abertura, sangria, suprimento e fechamento com conferência de espécie).

## [Etapa 3] - 2026-11-04
### Adicionado
- Catálogo único integrado aos 6 canais comerciais com preços específicos por canal, controle de custo e cálculo de margem bruta.
- Fichas técnicas versionadas (`product_recipes`) com baixa automática de insumos.
- Controle de estoque Kardex com estorno auditável (`REVERSAL_ENTRY`) e políticas `BLOCK_SALE` / `WARN_AND_ALLOW`.
- QR Code criptográfico não-previsível por mesa (`dining_tables_qr`).

## [Etapa 2] - 2026-11-03
### Adicionado
- Aplicação da paleta oficial Rosa (`#F72585`), Preto (`#111111`), Roxo (`#7209B7`) e Neutro (`#1A1A1A`).
- Persistência em disco independente para o servidor local e simulador da VPS usando `node:sqlite`.
- Pagamentos parciais, impressão incremental, autenticação por PIN HMAC e script `INICIAR-DECK26-DEV.bat`.

## [Etapa 1] - 2026-11-03
### Adicionado
- Estrutura inicial do monorepositório TypeScript (`apps/desktop`, `apps/local-server`, `apps/cloud-api`, `apps/web`, `packages/contracts`, `packages/ui`).

## 05/11/2026 — Revisão pré-7B

Correção de inicialização fiscal, autenticação e leitura por perfil, sessões/PIN, sincronização autenticada, tesouraria e custódia, atomicidade do PMS, DRE e fluxo histórico. Prévia interativa com paleta aprovada, botões e logo; Windows com semáforo de mesas e dashboard Recharts. 140 testes e smoke real das APIs. Escopo e limites em REVISAO_PRE_7B.md.
