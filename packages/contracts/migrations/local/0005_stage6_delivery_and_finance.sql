-- ============================================================================
-- DECK 26 — MIGRAÇÃO VERSIONADA LOCAL 0005 (SQLite 3 + WAL Mode)
-- Versão: 0005_stage6_delivery_and_finance
-- Objetivo: Delivery Próprio Completo, Gestão Financeira Integrada,
--           Contas a Pagar/Receber, Tesouraria/Contas Financeiras, Fluxo de Caixa,
--           DRE Gerencial por Competência e Registro de Compras/Fornecedores.
-- ============================================================================

-- 1. Regiões e Taxas de Entrega (delivery_zones)
CREATE TABLE IF NOT EXISTS delivery_zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  minimum_order_cents INTEGER NOT NULL DEFAULT 0,
  estimated_minutes INTEGER NOT NULL DEFAULT 40,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Entregadores / Motoboys Próprios e Prestadores (delivery_couriers)
CREATE TABLE IF NOT EXISTS delivery_couriers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'MOTO',
  vehicle_plate TEXT,
  fee_per_delivery_cents INTEGER NOT NULL DEFAULT 500,
  status TEXT NOT NULL DEFAULT 'DISPONIVEL' CHECK (status IN ('DISPONIVEL', 'EM_ENTREGA', 'INDISPONIVEL')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3. Clientes de Delivery (delivery_customers) com Proteção LGPD
CREATE TABLE IF NOT EXISTS delivery_customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  document TEXT,
  email TEXT,
  notes TEXT,
  total_orders INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delivery_customers_phone ON delivery_customers(phone);

-- 4. Endereços de Clientes (delivery_addresses)
CREATE TABLE IF NOT EXISTS delivery_addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES delivery_customers(id) ON DELETE CASCADE,
  street TEXT NOT NULL,
  number TEXT NOT NULL,
  complement TEXT,
  neighborhood TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Santa Inês',
  reference TEXT,
  delivery_zone_id TEXT REFERENCES delivery_zones(id),
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_delivery_addresses_cust ON delivery_addresses(customer_id);

-- 5. Centros de Custo (cost_centers)
CREATE TABLE IF NOT EXISTS cost_centers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- 6. Plano de Contas Gerencial (financial_categories)
CREATE TABLE IF NOT EXISTS financial_categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('REVENUE', 'DEDUCTION', 'COST_DIRECT', 'EXPENSE_OP', 'FINANCIAL_RESULT')),
  parent_id TEXT REFERENCES financial_categories(id),
  active INTEGER NOT NULL DEFAULT 1
);

-- 7. Contas Financeiras / Tesouraria (financial_accounts)
CREATE TABLE IF NOT EXISTS financial_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('CASH_DRAWER', 'BANK_ACCOUNT', 'PIX_KEY', 'COURIER_WALLET', 'SAFE_DEPOSIT')),
  bank_name TEXT,
  account_number TEXT,
  pix_key TEXT,
  current_balance_cents INTEGER NOT NULL DEFAULT 0,
  initial_balance_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 8. Pedidos de Delivery (delivery_orders)
CREATE TABLE IF NOT EXISTS delivery_orders (
  id TEXT PRIMARY KEY,
  order_number INTEGER NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  customer_id TEXT NOT NULL REFERENCES delivery_customers(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  delivery_type TEXT NOT NULL DEFAULT 'DELIVERY' CHECK (delivery_type IN ('DELIVERY', 'TAKEOUT')),
  origin TEXT NOT NULL DEFAULT 'SITE_WEB' CHECK (origin IN ('SITE_WEB', 'PHONE', 'WHATSAPP_MANUAL', 'COUNTER')),
  status TEXT NOT NULL DEFAULT 'NOVO' CHECK (status IN ('NOVO', 'AGUARDANDO_CONFIRMACAO', 'CONFIRMADO', 'EM_PREPARO', 'PRONTO', 'AGUARDANDO_ENTREGADOR', 'SAIU_PARA_ENTREGA', 'ENTREGUE', 'CANCELADO')),
  delivery_address_json TEXT,
  delivery_zone_id TEXT REFERENCES delivery_zones(id),
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
  items_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  payment_method_declared TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PAID', 'REFUNDED')),
  change_for_cents INTEGER,
  courier_id TEXT REFERENCES delivery_couriers(id),
  courier_name TEXT,
  courier_fee_cents INTEGER NOT NULL DEFAULT 0,
  estimated_delivery_at TEXT,
  dispatched_at TEXT,
  delivered_at TEXT,
  canceled_at TEXT,
  cancel_reason TEXT,
  settlement_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON delivery_orders(status);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_cust ON delivery_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_courier ON delivery_orders(courier_id);

-- 9. Acertos / Prestações de Contas de Entregadores (delivery_settlements)
CREATE TABLE IF NOT EXISTS delivery_settlements (
  id TEXT PRIMARY KEY,
  courier_id TEXT NOT NULL REFERENCES delivery_couriers(id),
  courier_name TEXT NOT NULL,
  shift_id TEXT,
  financial_account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  delivery_order_ids_json TEXT NOT NULL,
  total_deliveries INTEGER NOT NULL DEFAULT 0,
  total_cash_collected_cents INTEGER NOT NULL DEFAULT 0,
  total_courier_fees_cents INTEGER NOT NULL DEFAULT 0,
  net_amount_settled_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'SETTLED' CHECK (status IN ('PENDING', 'SETTLED')),
  settled_at TEXT NOT NULL,
  settled_by_staff_id TEXT NOT NULL,
  notes TEXT
);

-- 10. Fornecedores Cadastrados (suppliers)
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trade_name TEXT,
  document TEXT,
  email TEXT,
  phone TEXT,
  contact_person TEXT,
  category TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 11. Contas a Receber (accounts_receivable)
CREATE TABLE IF NOT EXISTS accounts_receivable (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('TAB', 'DELIVERY', 'HOTEL_FOLIO', 'DIRECT_SALE', 'MANUAL')),
  origin_reference_id TEXT,
  cost_center_id TEXT NOT NULL REFERENCES cost_centers(id),
  category_id TEXT NOT NULL REFERENCES financial_categories(id),
  total_amount_cents INTEGER NOT NULL,
  paid_amount_cents INTEGER NOT NULL DEFAULT 0,
  remaining_amount_cents INTEGER NOT NULL,
  accrual_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELED')),
  customer_name TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_receivable_due ON accounts_receivable(due_date);
CREATE INDEX IF NOT EXISTS idx_accounts_receivable_status ON accounts_receivable(status);

-- 12. Contas a Pagar (accounts_payable)
CREATE TABLE IF NOT EXISTS accounts_payable (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('PURCHASE_INVOICE', 'OPERATIONAL_EXPENSE', 'PAYROLL', 'MAINTENANCE', 'UTILITY', 'MANUAL')),
  origin_reference_id TEXT,
  supplier_id TEXT REFERENCES suppliers(id),
  supplier_name TEXT,
  cost_center_id TEXT NOT NULL REFERENCES cost_centers(id),
  category_id TEXT NOT NULL REFERENCES financial_categories(id),
  total_amount_cents INTEGER NOT NULL,
  paid_amount_cents INTEGER NOT NULL DEFAULT 0,
  remaining_amount_cents INTEGER NOT NULL,
  accrual_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELED')),
  invoice_number TEXT,
  barcode TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_payable_due ON accounts_payable(due_date);
CREATE INDEX IF NOT EXISTS idx_accounts_payable_status ON accounts_payable(status);

-- 13. Movimentações Financeiras Realizadas / Tesouraria (financial_transactions)
CREATE TABLE IF NOT EXISTS financial_transactions (
  id TEXT PRIMARY KEY,
  financial_account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  type TEXT NOT NULL CHECK (type IN ('INCOME', 'EXPENSE', 'INTERNAL_TRANSFER_IN', 'INTERNAL_TRANSFER_OUT')),
  category_id TEXT REFERENCES financial_categories(id),
  cost_center_id TEXT REFERENCES cost_centers(id),
  amount_cents INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  reference_type TEXT NOT NULL CHECK (reference_type IN ('ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE', 'POS_SALE', 'DELIVERY_SETTLEMENT', 'TRANSFER', 'MANUAL')),
  reference_id TEXT,
  description TEXT NOT NULL,
  accrual_date TEXT NOT NULL,
  settlement_date TEXT NOT NULL,
  registered_by_staff_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_financial_trans_acc ON financial_transactions(financial_account_id);
CREATE INDEX IF NOT EXISTS idx_financial_trans_accrual ON financial_transactions(accrual_date);
CREATE INDEX IF NOT EXISTS idx_financial_trans_settle ON financial_transactions(settlement_date);

-- 14. Transferências Internas entre Contas Financeiras (financial_transfers)
CREATE TABLE IF NOT EXISTS financial_transfers (
  id TEXT PRIMARY KEY,
  from_account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  to_account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  registered_by_staff_id TEXT NOT NULL,
  transferred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 15. Notas Fiscais e Compras de Fornecedores (purchase_invoices)
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  supplier_name TEXT NOT NULL,
  cost_center_id TEXT NOT NULL REFERENCES cost_centers(id),
  issue_date TEXT NOT NULL,
  total_amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELED')),
  accounts_payable_id TEXT REFERENCES accounts_payable(id),
  stock_moved INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 16. Itens de Compra (purchase_invoice_items)
CREATE TABLE IF NOT EXISTS purchase_invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES catalog_products(id),
  product_name TEXT NOT NULL,
  unit_of_measure TEXT NOT NULL DEFAULT 'UN',
  quantity REAL NOT NULL,
  unit_cost_cents INTEGER NOT NULL,
  total_cost_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_inv ON purchase_invoice_items(invoice_id);

-- 17. Conciliação Manual de Contas / Fechamento de Auditoria (account_reconciliations)
CREATE TABLE IF NOT EXISTS account_reconciliations (
  id TEXT PRIMARY KEY,
  financial_account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  reconciliation_date TEXT NOT NULL,
  system_calculated_balance_cents INTEGER NOT NULL,
  declared_physical_balance_cents INTEGER NOT NULL,
  difference_cents INTEGER NOT NULL,
  adjustment_transaction_id TEXT REFERENCES financial_transactions(id),
  status TEXT NOT NULL DEFAULT 'BALANCED' CHECK (status IN ('BALANCED', 'DISCREPANCY_ADJUSTED', 'DISCREPANCY_PENDING')),
  reconciled_by_staff_id TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);
