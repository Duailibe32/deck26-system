# Banco de Dados e Migrações — DECK 26

## 1. Dupla Persistência Local Independente

Durante o desenvolvimento e operação local sem VPS contratada, o sistema utiliza dois bancos SQLite independentes armazenados na pasta `data/` (ignorada pelo Git):

1. **`data/deck26-local.sqlite`**: banco transacional do estabelecimento gerenciado por `apps/local-server`, configurado com:
   - `PRAGMA journal_mode = WAL;`
   - `PRAGMA synchronous = FULL;`
   - `PRAGMA foreign_keys = ON;`
   - `PRAGMA busy_timeout = 5000;`
2. **`data/deck26-cloud-vps.sqlite`**: banco persistente do simulador da VPS gerenciado por `apps/cloud-api`.

### Diferença entre o SQLite da Nuvem Simulada e o PostgreSQL Planejado
- No ambiente de desenvolvimento pessoal (sem custos de hospedagem), `apps/cloud-api` utiliza `node:sqlite` (`data/deck26-cloud-vps.sqlite`) para simular a VPS sem exigir Docker ativo.
- Para a futura implantação na **Hostinger VPS**, todas as migrações equivalentes para **PostgreSQL 16** já estão mantidas em `packages/contracts/migrations/cloud/`.

---

## 2. Histórico de Migrações

### Migrações Locais (`packages/contracts/migrations/local/`)
1. **`0001_initial_schema.sql`**:
   - Tabelas base: `schema_migrations`, `users`, `catalog_categories`, `catalog_products`, `stock_balances`, `stock_movements`, `tabs`, `orders`, `order_items`, `cash_register_sessions`, `payments`, `print_jobs`, `hotel_rooms`, `fiscal_config`, `sync_outbox_events`, `sync_state`, `audit_logs`.
2. **`0002_stage3_catalog_stock_recipes_qr.sql`**:
   - Expansão de `catalog_categories` e `catalog_products` (custos, canais, ficha fiscal, política de falta de estoque, origem dos dados).
   - Tabelas `product_recipes`, `product_recipe_items` e `dining_tables_qr`.
3. **`0003_stage4_tables_tabs_kds_cashier.sql`**:
   - Colunas de estado físico, ocupação, garçom e junção de mesas em `dining_tables_qr`.
   - Colunas de desconto, taxa de serviço configurável, divisão de conta e mesas unidas em `tabs`.
   - Índice único parcial `idx_tabs_unique_active_table` impedindo duas comandas abertas simultaneamente para a mesma mesa.
   - Colunas de estágio de cancelamento, SLA e transferência de itens em `orders` e `order_items`.
   - Tabelas `cash_register_movements`, `operational_notifications` e `kds_sla_config`.
4. **`0004_stage5_hotel_pms.sql`**:
   - Expansão de `hotel_rooms` (colunas `floor_sector`, `bed_count`, `bed_configuration`, `amenities_json`, `occupancy_status`, `housekeeping_status`, `maintenance_status`, `active_stay_id`).
   - Tabela `hotel_guests`: cadastro com LGPD, nome, tipo e número de documento, telefone, e-mail, nacionalidade, data de nascimento, endereço JSON e notas.
   - Tabela `hotel_reservations`: reservas com código localizador, período [check_in, check_out), hóspedes, diária, sinal e status.
   - Tabela `hotel_stays`: estadias ativas/encerradas com hóspede, acompanhantes JSON, comanda de quarto vinculada (`tab_id`), diária congelada, early check-in, late check-out e notas.
   - Tabela `hotel_folio_entries`: razão contábil da estadia para débitos (diárias, restaurante, bar, frigobar, serviços) e créditos (sinal, pagamentos, estornos).
   - Tabelas de frigobar: `hotel_minibar_items` e `hotel_minibar_consumptions`.
   - Tabelas de serviços de hotelaria: `hotel_services` e `hotel_service_orders`.
   - Tabela de governança: `hotel_housekeeping_logs`.
   - Tabela de manutenção predial: `hotel_maintenance_records`.

### Migrações de Nuvem (`packages/contracts/migrations/cloud/`)
1. **`0001_initial_cloud_schema.sql`**
2. **`0002_stage3_cloud_catalog_recipes_qr.sql`**
3. **`0003_stage4_cloud_tables_tabs_kds_cashier.sql`**
4. **`0004_stage5_cloud_hotel_pms.sql`**:
   - Compatibilidade total PostgreSQL 16 com tipos UUID, TIMESTAMP WITH TIME ZONE, JSONB e índices de busca para o módulo hoteleiro.
