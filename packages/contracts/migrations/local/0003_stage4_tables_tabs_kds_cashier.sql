-- ============================================================================
-- DECK 26 — MIGRAÇÃO VERSIONADA LOCAL 0003 (SQLite 3 + WAL Mode)
-- Versão: 0003_stage4_tables_tabs_kds_cashier
-- Objetivo: Operação profissional de Mesas (estado físico separado do financeiro),
--           Abertura com bloqueio concorrente no banco, Transferência e Junção de Mesas,
--           Transferência de Itens entre Comandas, Divisão de Contas, Descontos Autorizados,
--           KDS com SLA/Tempos, Notificações Cozinha -> Garçom, Impressão com UNKNOWN_OUTCOME
--           e Turnos de Caixa com Sangria/Suprimento/Fechamento Auditável.
-- ============================================================================

-- 1. Expansão Física das Mesas (dining_tables_qr atua como cadastro físico + token QR seguro)
ALTER TABLE dining_tables_qr ADD COLUMN physical_status TEXT NOT NULL DEFAULT 'LIVRE';
ALTER TABLE dining_tables_qr ADD COLUMN active_tab_id TEXT REFERENCES tabs(id);
ALTER TABLE dining_tables_qr ADD COLUMN primary_table_number INTEGER;
ALTER TABLE dining_tables_qr ADD COLUMN joined_group_id TEXT;
ALTER TABLE dining_tables_qr ADD COLUMN assigned_waiter_user_id TEXT;
ALTER TABLE dining_tables_qr ADD COLUMN assigned_waiter_name TEXT;
ALTER TABLE dining_tables_qr ADD COLUMN guests_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dining_tables_qr ADD COLUMN opened_at TEXT;
ALTER TABLE dining_tables_qr ADD COLUMN notes TEXT;
ALTER TABLE dining_tables_qr ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2026-11-04T00:00:00.000Z';

-- 2. Restrição de Unicidade Concorrente no Banco para Impedir Duas Aberturas Simultâneas da Mesma Mesa
CREATE UNIQUE INDEX IF NOT EXISTS idx_tabs_unique_active_table
  ON tabs(table_number)
  WHERE table_number IS NOT NULL AND status IN ('OPEN', 'BILL_REQUESTED', 'PARTIALLY_PAID');

-- 3. Expansão de Comandas Profissionais (tabs)
ALTER TABLE tabs ADD COLUMN waiter_user_id TEXT;
ALTER TABLE tabs ADD COLUMN waiter_name TEXT;
ALTER TABLE tabs ADD COLUMN notes TEXT;
ALTER TABLE tabs ADD COLUMN joined_tables_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tabs ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE tabs ADD COLUMN discount_bps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tabs ADD COLUMN discount_reason TEXT;
ALTER TABLE tabs ADD COLUMN discount_authorized_by_user_id TEXT;
ALTER TABLE tabs ADD COLUMN split_plan_json TEXT;
ALTER TABLE tabs ADD COLUMN closed_by_user_id TEXT;
ALTER TABLE tabs ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2026-11-04T00:00:00.000Z';

-- 4. Expansão de Pedidos (orders) e Itens (order_items) para KDS, Cancelamento por Estágio e Transferência de Itens
ALTER TABLE orders ADD COLUMN priority TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE orders ADD COLUMN prep_started_at TEXT;
ALTER TABLE orders ADD COLUMN ready_at TEXT;
ALTER TABLE orders ADD COLUMN waiter_notified_at TEXT;
ALTER TABLE orders ADD COLUMN delivered_at TEXT;
ALTER TABLE orders ADD COLUMN delivered_by_user_id TEXT;
ALTER TABLE orders ADD COLUMN cancel_stage TEXT;
ALTER TABLE orders ADD COLUMN cancel_reason TEXT;
ALTER TABLE orders ADD COLUMN cancelled_by_user_id TEXT;
ALTER TABLE orders ADD COLUMN cancelled_at TEXT;

ALTER TABLE order_items ADD COLUMN transferred_from_tab_id TEXT;
ALTER TABLE order_items ADD COLUMN transferred_from_order_id TEXT;
ALTER TABLE order_items ADD COLUMN transferred_at TEXT;
ALTER TABLE order_items ADD COLUMN transferred_by_user_id TEXT;
ALTER TABLE order_items ADD COLUMN paid_quantity REAL NOT NULL DEFAULT 0;

-- 5. Expansão de Pagamentos (payments) — Confirmação Manual vs Eletrônica, Divisão e Estorno Auditável
ALTER TABLE payments ADD COLUMN confirmation_mode TEXT NOT NULL DEFAULT 'MANUAL_DECLARED';
ALTER TABLE payments ADD COLUMN payer_label TEXT;
ALTER TABLE payments ADD COLUMN allocated_items_json TEXT;
ALTER TABLE payments ADD COLUMN refund_reason TEXT;
ALTER TABLE payments ADD COLUMN refunded_by_user_id TEXT;
ALTER TABLE payments ADD COLUMN refunded_at TEXT;

-- 6. Expansão da Fila de Impressão Térmica (print_jobs) — 2ª Via Identificada e Estados de Falha/Resultado Desconhecido
ALTER TABLE print_jobs ADD COLUMN is_reprint INTEGER NOT NULL DEFAULT 0;
ALTER TABLE print_jobs ADD COLUMN copy_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE print_jobs ADD COLUMN reprint_authorized_by_user_id TEXT;
ALTER TABLE print_jobs ADD COLUMN updated_at TEXT;

-- 7. Expansão de Turnos de Caixa (cash_register_sessions) e Movimentações de Turno (Sangria / Suprimento)
ALTER TABLE cash_register_sessions ADD COLUMN expected_balance_cents INTEGER;
ALTER TABLE cash_register_sessions ADD COLUMN counted_balance_cents INTEGER;
ALTER TABLE cash_register_sessions ADD COLUMN difference_cents INTEGER;
ALTER TABLE cash_register_sessions ADD COLUMN notes TEXT;

CREATE TABLE IF NOT EXISTS cash_register_movements (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES cash_register_sessions(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('SANGRIA', 'SUPRIMENTO', 'AUTHORIZED_OUTFLOW', 'MANUAL_INFLOW')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  authorized_by_user_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_register_movements(session_id);

-- 8. Notificações Operacionais em Tempo Real (Cozinha -> Garçom / Alertas KDS)
CREATE TABLE IF NOT EXISTS operational_notifications (
  cursor_id INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  target_role TEXT,
  target_user_id TEXT,
  table_number INTEGER,
  tab_id TEXT,
  order_id TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  acknowledged_at TEXT,
  acknowledged_by_user_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operational_notifications_cursor ON operational_notifications(cursor_id);

-- 9. Configuração de SLA do KDS e Parâmetros Operacionais do Estabelecimento
CREATE TABLE IF NOT EXISTS kds_sla_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  warning_threshold_minutes INTEGER NOT NULL DEFAULT 10,
  delayed_threshold_minutes INTEGER NOT NULL DEFAULT 20,
  updated_at TEXT NOT NULL
);
