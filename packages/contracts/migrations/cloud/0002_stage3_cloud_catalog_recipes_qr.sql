-- ============================================================================
-- DECK 26 — MIGRAÇÃO VERSIONADA CLOUD VPS 0002 (PostgreSQL 16+)
-- Versão: 0002_stage3_cloud_catalog_recipes_qr
-- Objetivo: Espelhar na futura Hostinger VPS todos os atributos de catálogo,
--           preços por canal, fichas técnicas, dados fiscais e tokens QR Code.
-- ============================================================================

ALTER TABLE catalog_categories
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS available_channels JSONB NOT NULL DEFAULT '["DINE_IN","COUNTER_PDV","QR_TABLE","DELIVERY","PICKUP","HOTEL_ROOM"]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(64),
  ADD COLUMN IF NOT EXISTS subcategory VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS unit_of_measure VARCHAR(16) NOT NULL DEFAULT 'UN',
  ADD COLUMN IF NOT EXISTS cost_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_price_cents >= 0),
  ADD COLUMN IF NOT EXISTS channel_prices JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS min_stock_quantity NUMERIC(12, 3) NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS out_of_stock_policy VARCHAR(32) NOT NULL DEFAULT 'BLOCK_SALE',
  ADD COLUMN IF NOT EXISTS target_printer VARCHAR(40) NOT NULL DEFAULT 'PRINTER_KITCHEN_HOT',
  ADD COLUMN IF NOT EXISTS prep_time_minutes INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS internal_notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cest VARCHAR(16),
  ADD COLUMN IF NOT EXISTS merchandise_origin VARCHAR(4) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS tax_profile VARCHAR(64) NOT NULL DEFAULT 'REVISAO_CONTABIL_PENDENTE',
  ADD COLUMN IF NOT EXISTS data_source VARCHAR(32) NOT NULL DEFAULT 'OFFICIAL_MENU',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS product_recipes (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL REFERENCES catalog_products(id),
  version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(24) NOT NULL,
  yield_quantity NUMERIC(12, 3) NOT NULL DEFAULT 1,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  approved_by_user_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, version)
);

CREATE TABLE IF NOT EXISTS product_recipe_items (
  id VARCHAR(64) PRIMARY KEY,
  recipe_id VARCHAR(64) NOT NULL REFERENCES product_recipes(id) ON DELETE CASCADE,
  ingredient_product_id VARCHAR(64) NOT NULL REFERENCES catalog_products(id),
  ingredient_name VARCHAR(200) NOT NULL,
  quantity_used NUMERIC(12, 4) NOT NULL CHECK (quantity_used > 0),
  unit_of_measure VARCHAR(16) NOT NULL DEFAULT 'UN',
  unit_cost_cents INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128) UNIQUE,
  ADD COLUMN IF NOT EXISTS origin_channel VARCHAR(40) NOT NULL DEFAULT 'WINDOWS_PDV',
  ADD COLUMN IF NOT EXISTS reversed_by_movement_id UUID;

CREATE TABLE IF NOT EXISTS dining_tables_qr (
  table_number INTEGER PRIMARY KEY CHECK (table_number > 0),
  qr_token VARCHAR(128) NOT NULL UNIQUE,
  label VARCHAR(80) NOT NULL,
  requires_operator_approval BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
