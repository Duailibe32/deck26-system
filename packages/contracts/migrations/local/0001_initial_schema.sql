-- ============================================================================
-- DECK 26 — MIGRAÇÃO VERSIONADA LOCAL (SQLite 3 + WAL Mode)
-- Versão: 0001_initial_schema
-- Objetivo: Garantir operação 100% offline na Wi-Fi local (PDV Windows,
--           5 Celulares de Garçons e 1 KDS de Cozinha) com separação estrita
--           entre Catálogo, Comanda (Tab), Pedido (Order), Pagamento (Payment),
--           Impressão (PrintJob), Estoque (StockMovement) e Outbox de Sync.
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- 1. USUÁRIOS E PERMISSÕES LOCAIS (Autenticação rápida por PIN e Token JWT)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- 2. CATÁLOGO LÓGICO ÚNICO COMPARTILHADO ENTRE OS CANAIS
CREATE TABLE IF NOT EXISTS catalog_categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS catalog_products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL REFERENCES catalog_categories(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  available_channels_json TEXT NOT NULL,
  prep_station TEXT NOT NULL,
  track_stock INTEGER NOT NULL DEFAULT 1,
  modifier_groups_json TEXT NOT NULL DEFAULT '[]',
  ncm TEXT,
  cfop TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- 3. TURNOS DE CAIXA (Cash Register Sessions)
CREATE TABLE IF NOT EXISTS cash_register_sessions (
  id TEXT PRIMARY KEY,
  opened_by_user_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  closed_by_user_id TEXT,
  closed_at TEXT,
  closing_balance_cents INTEGER,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED'))
);

-- 4. COMANDAS / MESAS / CONTAS DE QUARTO (Tab — Entidade Separada de Pedido)
CREATE TABLE IF NOT EXISTS tabs (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('TABLE', 'INDIVIDUAL_CARD', 'COUNTER', 'HOTEL_FOLIO')),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'BILL_REQUESTED', 'PARTIALLY_PAID', 'CLOSED', 'CANCELLED')),
  table_number INTEGER,
  hotel_reservation_id TEXT,
  customer_name TEXT,
  guests_count INTEGER NOT NULL DEFAULT 1,
  service_fee_enabled INTEGER NOT NULL DEFAULT 1,
  service_fee_bps INTEGER NOT NULL DEFAULT 1000,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  service_fee_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  opened_by_user_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_tabs_status ON tabs(status);
CREATE INDEX IF NOT EXISTS idx_tabs_code ON tabs(code);

-- 5. PEDIDOS E ITENS DE PEDIDO (Order & OrderItem — Entidade Separada de Comanda)
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tab_id TEXT REFERENCES tabs(id),
  channel TEXT NOT NULL,
  origin_node TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('RECEIVED', 'IN_PREPARATION', 'READY', 'DELIVERED', 'CANCELLED')),
  waiter_user_id TEXT,
  waiter_name TEXT,
  table_number INTEGER,
  customer_notes TEXT,
  total_order_cents INTEGER NOT NULL CHECK (total_order_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_orders_tab_id ON orders(tab_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES catalog_products(id),
  product_name TEXT NOT NULL,
  prep_station TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  modifiers_total_cents INTEGER NOT NULL DEFAULT 0,
  total_item_cents INTEGER NOT NULL CHECK (total_item_cents >= 0),
  notes TEXT,
  modifiers_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'RECEIVED'
);

-- 6. PAGAMENTOS (Payment — Entidade Separada)
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  tab_id TEXT NOT NULL REFERENCES tabs(id),
  cash_register_session_id TEXT NOT NULL REFERENCES cash_register_sessions(id),
  method TEXT NOT NULL CHECK (method IN ('CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'ROOM_CHARGE', 'VOUCHER')),
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'REFUNDED', 'PENDING')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  received_cash_cents INTEGER,
  change_cents INTEGER NOT NULL DEFAULT 0,
  nsu_or_tx_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  operator_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_tab_id ON payments(tab_id);

-- 7. FILA DE IMPRESSÃO TÉRMICA ESC/POS (PrintJob — Entidade Separada)
CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  target_printer TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'PRINTING', 'PRINTED', 'FAILED')),
  reference_entity_type TEXT NOT NULL,
  reference_entity_id TEXT NOT NULL,
  payload_text TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  printed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);

-- 8. RAZÃO DE MOVIMENTAÇÃO DE ESTOQUE (StockMovement — Entidade Separada)
CREATE TABLE IF NOT EXISTS stock_balances (
  product_id TEXT PRIMARY KEY REFERENCES catalog_products(id),
  current_quantity REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES catalog_products(id),
  product_name TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('PURCHASE_ENTRY', 'SALE_DEDUCTION', 'WASTE_OR_LOSS', 'INVENTORY_ADJUST', 'INTERNAL_USE')),
  quantity_delta REAL NOT NULL,
  balance_after REAL NOT NULL,
  unit_cost_cents INTEGER,
  reference_entity_type TEXT,
  reference_entity_id TEXT,
  reason TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 9. APARTAMENTOS DO HOTEL AUTO POSTO MILLA
CREATE TABLE IF NOT EXISTS hotel_rooms (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  daily_rate_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'DIRTY_CLEANING', 'MAINTENANCE', 'RESERVED')),
  current_guest_name TEXT,
  active_tab_id TEXT REFERENCES tabs(id),
  updated_at TEXT NOT NULL
);

-- 10. CONFIGURAÇÃO FISCAL REAL
CREATE TABLE IF NOT EXISTS fiscal_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cnpj TEXT NOT NULL DEFAULT '',
  razao_social TEXT NOT NULL DEFAULT '',
  nome_fantasia TEXT NOT NULL DEFAULT 'DECK 26 - HOTEL AUTO POSTO MILLA',
  inscricao_estadual TEXT NOT NULL DEFAULT '',
  uf TEXT NOT NULL DEFAULT 'MA',
  ambiente TEXT NOT NULL DEFAULT 'HOMOLOGATION',
  mode TEXT NOT NULL DEFAULT 'DISABLED_NOT_CONFIGURED',
  csc_id TEXT,
  certificate_configured INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- 11. EVENTOS PERSISTENTES DE SINCRONIZAÇÃO (OUTBOX & INBOX COM IDEMPOTÊNCIA)
CREATE TABLE IF NOT EXISTS sync_outbox_events (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  origin_node TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  entity_version INTEGER NOT NULL,
  hlc_timestamp TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'IN_FLIGHT', 'ACKED', 'CONFLICT', 'FAILED_RETRY')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  conflict_reason TEXT,
  created_at TEXT NOT NULL,
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_status ON sync_outbox_events(status, created_at);

CREATE TABLE IF NOT EXISTS sync_inbox_applied (
  idempotency_key TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  origin_node TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

-- 12. TRILHA DE AUDITORIA IMUTÁVEL
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
