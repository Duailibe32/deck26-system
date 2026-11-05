-- ============================================================================
-- DECK 26 — MIGRAÇÃO VERSIONADA CLOUD 0006 (PostgreSQL / Supabase)
-- Versão: 0006_stage7a_cloud_rooms_catalog_fiscal
-- ============================================================================

ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS name VARCHAR(100) DEFAULT '';
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS photos_json JSONB DEFAULT '[]'::jsonb;
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS commercial_status VARCHAR(30) NOT NULL DEFAULT 'OPERACIONAL';

ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS ncm VARCHAR(20) DEFAULT '2106.90.90';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS cfop VARCHAR(10) DEFAULT '5.102';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS csosn VARCHAR(10) DEFAULT '102';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS cst_icms VARCHAR(10) DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS cst_pis VARCHAR(10) DEFAULT '49';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS cst_cofins VARCHAR(10) DEFAULT '49';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS origem_mercadoria INTEGER DEFAULT 0;
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS verification_pending_json JSONB DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS fiscal_establishments (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  cnpj VARCHAR(14) NOT NULL,
  razao_social VARCHAR(255) NOT NULL,
  nome_fantasia VARCHAR(255) NOT NULL,
  inscricao_estadual VARCHAR(50) DEFAULT '',
  inscricao_municipal VARCHAR(50) DEFAULT '',
  cnae VARCHAR(20) DEFAULT '',
  tax_regime VARCHAR(30) NOT NULL DEFAULT 'SIMPLES_NACIONAL',
  segment VARCHAR(30) NOT NULL DEFAULT 'RESTAURANT',
  address_street VARCHAR(255) DEFAULT '',
  address_number VARCHAR(50) DEFAULT '',
  address_city VARCHAR(100) DEFAULT '',
  address_state VARCHAR(2) DEFAULT 'MA',
  address_postal_code VARCHAR(20) DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fiscal_documents (
  id VARCHAR(64) PRIMARY KEY,
  document_type VARCHAR(30) NOT NULL,
  establishment_id VARCHAR(64) NOT NULL REFERENCES fiscal_establishments(id),
  establishment_cnpj VARCHAR(14) NOT NULL,
  series INTEGER NOT NULL DEFAULT 1,
  number INTEGER NOT NULL,
  access_key VARCHAR(60) DEFAULT '',
  origin_reference_type VARCHAR(30) NOT NULL,
  origin_reference_id VARCHAR(64) NOT NULL,
  customer_name VARCHAR(255) DEFAULT 'Consumidor Final',
  customer_tax_id VARCHAR(20) DEFAULT '',
  gross_total_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  net_total_cents INTEGER NOT NULL,
  tax_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  items_summary_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'SIMULATED_DEMO',
  is_simulated BOOLEAN NOT NULL DEFAULT TRUE,
  watermark VARCHAR(100) NOT NULL DEFAULT 'SEM VALIDADE FISCAL - DEMO',
  qr_code_url TEXT DEFAULT '',
  simulated_xml TEXT DEFAULT '',
  simulated_danfe_text TEXT DEFAULT '',
  cancellation_reason TEXT,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cloud_fiscal_docs_origin ON fiscal_documents(origin_reference_type, origin_reference_id);
CREATE INDEX IF NOT EXISTS idx_cloud_fiscal_docs_status ON fiscal_documents(status);
CREATE INDEX IF NOT EXISTS idx_cloud_fiscal_docs_est ON fiscal_documents(establishment_id);
