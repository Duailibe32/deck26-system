-- ============================================================================
-- DECK 26 — MIGRAÇÃO VERSIONADA CLOUD 0003 (PostgreSQL 16+ — Hostinger VPS)
-- Versão: 0003_stage4_cloud_tables_tabs_kds_cashier
-- Objetivo: Espelhar na nuvem as estruturas da Etapa 4 (Mesas, Comandas, KDS,
--           Divisão de Contas, Turnos de Caixa, Sangrias e Notificações).
-- ============================================================================

ALTER TABLE dining_tables_qr ADD COLUMN IF NOT EXISTS physical_status TEXT NOT NULL DEFAULT 'LIVRE';
ALTER TABLE dining_tables_qr ADD COLUMN IF NOT EXISTS active_tab_id UUID;
ALTER TABLE dining_tables_qr ADD COLUMN IF NOT EXISTS primary_table_number INTEGER;
ALTER TABLE dining_tables_qr ADD COLUMN IF NOT EXISTS joined_group_id TEXT;
ALTER TABLE dining_tables_qr ADD COLUMN IF NOT EXISTS assigned_waiter_user_id TEXT;
ALTER TABLE dining_tables_qr ADD COLUMN IF NOT EXISTS assigned_waiter_name TEXT;
ALTER TABLE dining_tables_qr ADD COLUMN IF NOT EXISTS guests_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dining_tables_qr ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE dining_tables_qr ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE dining_tables_qr ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS cash_register_movements (
  id UUID PRIMARY KEY,
  session_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  authorized_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operational_notifications (
  cursor_id BIGSERIAL PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  target_role TEXT,
  target_user_id TEXT,
  table_number INTEGER,
  tab_id UUID,
  order_id UUID,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kds_sla_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  warning_threshold_minutes INTEGER NOT NULL DEFAULT 10,
  delayed_threshold_minutes INTEGER NOT NULL DEFAULT 20,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
