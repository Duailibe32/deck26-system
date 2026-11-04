-- ============================================================================
-- DECK 26 — MIGRAÇÃO VERSIONADA LOCAL 0002 (SQLite 3 + WAL Mode)
-- Versão: 0002_stage3_catalog_stock_recipes_qr
-- Objetivo: Expandir o catálogo único, categorias, fichas técnicas (receitas),
--           controle de estoque avançado e tokens criptográficos de QR Code
--           por mesa, preservando 100% dos dados existentes sem duplicar tabelas.
-- ============================================================================

-- 1. Expansão de Categorias (descrição, imagem opcional e canais de exibição)
ALTER TABLE catalog_categories ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_categories ADD COLUMN image_url TEXT;
ALTER TABLE catalog_categories ADD COLUMN available_channels_json TEXT NOT NULL DEFAULT '["DINE_IN","COUNTER_PDV","QR_TABLE","DELIVERY","PICKUP","HOTEL_ROOM"]';
ALTER TABLE catalog_categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2026-11-04T00:00:00.000Z';

-- 2. Expansão Completa do Cadastro de Produtos (Preços por canal, Custo, Estoque mínimo, Impressora destino, Fiscal, Origem Oficial vs Teste)
ALTER TABLE catalog_products ADD COLUMN barcode TEXT;
ALTER TABLE catalog_products ADD COLUMN subcategory TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN image_url TEXT;
ALTER TABLE catalog_products ADD COLUMN unit_of_measure TEXT NOT NULL DEFAULT 'UN';
ALTER TABLE catalog_products ADD COLUMN cost_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_price_cents >= 0);
ALTER TABLE catalog_products ADD COLUMN channel_prices_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE catalog_products ADD COLUMN min_stock_quantity REAL NOT NULL DEFAULT 5;
ALTER TABLE catalog_products ADD COLUMN out_of_stock_policy TEXT NOT NULL DEFAULT 'BLOCK_SALE' CHECK (out_of_stock_policy IN ('BLOCK_SALE', 'ALLOW_BACKORDER'));
ALTER TABLE catalog_products ADD COLUMN target_printer TEXT NOT NULL DEFAULT 'PRINTER_KITCHEN_HOT';
ALTER TABLE catalog_products ADD COLUMN prep_time_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE catalog_products ADD COLUMN internal_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN cest TEXT;
ALTER TABLE catalog_products ADD COLUMN merchandise_origin TEXT NOT NULL DEFAULT '0';
ALTER TABLE catalog_products ADD COLUMN tax_profile TEXT NOT NULL DEFAULT 'REVISAO_CONTABIL_PENDENTE';
ALTER TABLE catalog_products ADD COLUMN data_source TEXT NOT NULL DEFAULT 'OFFICIAL_MENU' CHECK (data_source IN ('OFFICIAL_MENU', 'TEST_ONLY'));
ALTER TABLE catalog_products ADD COLUMN created_at TEXT NOT NULL DEFAULT '2026-11-04T00:00:00.000Z';

-- 3. Fichas Técnicas Versionadas e Ingredientes (Opcional — nunca inventa receitas)
CREATE TABLE IF NOT EXISTS product_recipes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES catalog_products(id),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'APPROVED', 'ARCHIVED')),
  yield_quantity REAL NOT NULL DEFAULT 1 CHECK (yield_quantity > 0),
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  approved_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(product_id, version)
);

CREATE TABLE IF NOT EXISTS product_recipe_items (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES product_recipes(id) ON DELETE CASCADE,
  ingredient_product_id TEXT NOT NULL REFERENCES catalog_products(id),
  ingredient_name TEXT NOT NULL,
  quantity_used REAL NOT NULL CHECK (quantity_used > 0),
  unit_of_measure TEXT NOT NULL DEFAULT 'UN',
  unit_cost_cents INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_product_recipes_product ON product_recipes(product_id, status);

-- 4. Expansão de Movimentações de Estoque (Idempotência, Origem e Reversão Auditável)
-- Nota: recriamos o índice único de idempotência para proibir baixas duplicadas
ALTER TABLE stock_movements ADD COLUMN idempotency_key TEXT;
ALTER TABLE stock_movements ADD COLUMN origin_channel TEXT NOT NULL DEFAULT 'WINDOWS_PDV';
ALTER TABLE stock_movements ADD COLUMN reversed_by_movement_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_movements_idempotency
  ON stock_movements(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 5. Tokens Não-Previsíveis de QR Code por Mesa e Política de Aprovação de Pedidos QR
CREATE TABLE IF NOT EXISTS dining_tables_qr (
  table_number INTEGER PRIMARY KEY CHECK (table_number > 0),
  qr_token TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  requires_operator_approval INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dining_tables_qr_token ON dining_tables_qr(qr_token);
