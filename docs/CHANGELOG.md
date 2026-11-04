# Changelog — DECK 26

Todas as mudanças relevantes do projeto **DECK 26** são documentadas neste arquivo.

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
