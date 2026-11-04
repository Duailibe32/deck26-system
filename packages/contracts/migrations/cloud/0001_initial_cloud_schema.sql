-- ============================================================================
-- DECK 26 — MIGRAÇÃO VERSIONADA CLOUD VPS (PostgreSQL 16+)
-- Versão: 0001_initial_cloud_schema
-- Objetivo: Persistência central na Hostinger VPS para Cardápio Digital QR,
--           Delivery, Retaguarda do Proprietário, Backups e Reconciliação
--           Bidirecional Idempotente com o Servidor Operacional Local.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog_categories (
  id VARCHAR(64) PRIMARY KEY,
  slug VARCHAR(120) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS catalog_products (
  id VARCHAR(64) PRIMARY KEY,
  sku VARCHAR(64) NOT NULL UNIQUE,
  category_id VARCHAR(64) NOT NULL REFERENCES catalog_categories(id),
  name VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  available_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  prep_station VARCHAR(40) NOT NULL,
  track_stock BOOLEAN NOT NULL DEFAULT TRUE,
  modifier_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
  ncm CHAR(8),
  cfop CHAR(4),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tabs (
  id UUID PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  table_number INTEGER,
  hotel_reservation_id UUID,
  customer_name VARCHAR(160),
  guests_count INTEGER NOT NULL DEFAULT 1,
  service_fee_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  service_fee_bps INTEGER NOT NULL DEFAULT 1000,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  service_fee_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  opened_by_user_id VARCHAR(64) NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  tab_id UUID REFERENCES tabs(id),
  channel VARCHAR(32) NOT NULL,
  origin_node VARCHAR(40) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL,
  waiter_user_id VARCHAR(64),
  waiter_name VARCHAR(140),
  table_number INTEGER,
  customer_notes TEXT,
  items_json JSONB NOT NULL,
  total_order_cents INTEGER NOT NULL CHECK (total_order_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY,
  tab_id UUID NOT NULL REFERENCES tabs(id),
  cash_register_session_id VARCHAR(64) NOT NULL,
  method VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  received_cash_cents INTEGER,
  change_cents INTEGER NOT NULL DEFAULT 0,
  nsu_or_tx_id VARCHAR(128),
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  operator_user_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL REFERENCES catalog_products(id),
  product_name VARCHAR(200) NOT NULL,
  movement_type VARCHAR(40) NOT NULL,
  quantity_delta NUMERIC(12, 3) NOT NULL,
  balance_after NUMERIC(12, 3) NOT NULL,
  unit_cost_cents INTEGER,
  reference_entity_type VARCHAR(40),
  reference_entity_id VARCHAR(64),
  reason TEXT NOT NULL,
  created_by_user_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

-- LEDGER CENTRAL DE EVENTOS SINCRONIZADOS (IDEMPOTÊNCIA E CURSOR SEQUENCIAL)
CREATE TABLE IF NOT EXISTS sync_event_ledger (
  cursor_seq BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  origin_node VARCHAR(40) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  operation VARCHAR(32) NOT NULL,
  entity_version INTEGER NOT NULL,
  hlc_timestamp VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  checksum_sha256 VARCHAR(64) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_ledger_cursor ON sync_event_ledger(cursor_seq);
CREATE INDEX IF NOT EXISTS idx_sync_ledger_entity ON sync_event_ledger(entity_type, entity_id);
