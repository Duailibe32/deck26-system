-- ============================================================================
-- DECK 26 — MIGRAÇÃO VERSIONADA LOCAL 0006 (SQLite 3 + WAL Mode)
-- Versão: 0006_stage7a_rooms_catalog_fiscal
-- Objetivo: Gestão de 24 Apartamentos do Hotel Auto Posto Milla (12 Operacionais + 12 Em Construção),
--           Catálogo com Campos Fiscais e Suporte a 93 Produtos do Cardápio Oficial,
--           Estrutura de Multi-Estabelecimentos Fiscais (Restaurante CNPJ vs Hotel CNPJ),
--           Documentos Fiscais Simulados (NFC-e, NF-e, NFS-e) com Marca d'Água e Sem Validade Fiscal.
-- ============================================================================

-- 1. Expansão de Apartamentos Hoteleiros (Nome opcional, Fotos e Status Comercial)
ALTER TABLE hotel_rooms ADD COLUMN name TEXT DEFAULT '';
ALTER TABLE hotel_rooms ADD COLUMN photos_json TEXT DEFAULT '[]';
ALTER TABLE hotel_rooms ADD COLUMN commercial_status TEXT NOT NULL DEFAULT 'OPERACIONAL';

-- 2. Expansão Tributária de Produtos (NCM, CFOP, CSOSN, CST e Pendências Cadastrais)
ALTER TABLE catalog_products ADD COLUMN ncm TEXT DEFAULT '2106.90.90';
ALTER TABLE catalog_products ADD COLUMN cfop TEXT DEFAULT '5.102';
ALTER TABLE catalog_products ADD COLUMN csosn TEXT DEFAULT '102';
ALTER TABLE catalog_products ADD COLUMN cst_icms TEXT DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN cst_pis TEXT DEFAULT '49';
ALTER TABLE catalog_products ADD COLUMN cst_cofins TEXT DEFAULT '49';
ALTER TABLE catalog_products ADD COLUMN origem_mercadoria INTEGER DEFAULT 0;
ALTER TABLE catalog_products ADD COLUMN verification_pending_json TEXT DEFAULT '[]';

-- 3. Multi-Estabelecimentos Fiscais (Restaurante CNPJ vs Hotel CNPJ)
CREATE TABLE IF NOT EXISTS fiscal_establishments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  cnpj TEXT NOT NULL,
  razao_social TEXT NOT NULL,
  nome_fantasia TEXT NOT NULL,
  inscricao_estadual TEXT DEFAULT '',
  inscricao_municipal TEXT DEFAULT '',
  cnae TEXT DEFAULT '',
  tax_regime TEXT NOT NULL DEFAULT 'SIMPLES_NACIONAL',
  segment TEXT NOT NULL DEFAULT 'RESTAURANT',
  address_street TEXT DEFAULT '',
  address_number TEXT DEFAULT '',
  address_city TEXT DEFAULT '',
  address_state TEXT DEFAULT 'MA',
  address_postal_code TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- 4. Documentos Fiscais Modelados e Auditados (NFC-e, NF-e, NFS-e)
CREATE TABLE IF NOT EXISTS fiscal_documents (
  id TEXT PRIMARY KEY,
  document_type TEXT NOT NULL,
  establishment_id TEXT NOT NULL REFERENCES fiscal_establishments(id),
  establishment_cnpj TEXT NOT NULL,
  series INTEGER NOT NULL DEFAULT 1,
  number INTEGER NOT NULL,
  access_key TEXT DEFAULT '',
  origin_reference_type TEXT NOT NULL,
  origin_reference_id TEXT NOT NULL,
  customer_name TEXT DEFAULT 'Consumidor Final',
  customer_tax_id TEXT DEFAULT '',
  gross_total_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  net_total_cents INTEGER NOT NULL,
  tax_summary_json TEXT NOT NULL DEFAULT '{}',
  items_summary_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'SIMULATED_DEMO',
  is_simulated INTEGER NOT NULL DEFAULT 1,
  watermark TEXT NOT NULL DEFAULT 'SEM VALIDADE FISCAL - DEMO',
  qr_code_url TEXT DEFAULT '',
  simulated_xml TEXT DEFAULT '',
  simulated_danfe_text TEXT DEFAULT '',
  cancellation_reason TEXT,
  canceled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fiscal_docs_origin ON fiscal_documents(origin_reference_type, origin_reference_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_status ON fiscal_documents(status);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_est ON fiscal_documents(establishment_id);
