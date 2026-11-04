-- ============================================================================
-- DECK 26 — MIGRAÇÃO VERSIONADA NUVEM 0005 (PostgreSQL 16+)
-- Versão: 0005_stage6_cloud_delivery_and_finance
-- ============================================================================

CREATE TABLE IF NOT EXISTS delivery_zones (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  minimum_order_cents INTEGER NOT NULL DEFAULT 0,
  estimated_minutes INTEGER NOT NULL DEFAULT 40,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_couriers (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(64) NOT NULL,
  vehicle_type VARCHAR(32) NOT NULL DEFAULT 'MOTO',
  vehicle_plate VARCHAR(32),
  fee_per_delivery_cents INTEGER NOT NULL DEFAULT 500,
  status VARCHAR(32) NOT NULL DEFAULT 'DISPONIVEL',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_customers (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(64) NOT NULL UNIQUE,
  document VARCHAR(64),
  email VARCHAR(255),
  notes TEXT,
  total_orders INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_delivery_customers_phone ON delivery_customers(phone);

CREATE TABLE IF NOT EXISTS delivery_addresses (
  id VARCHAR(64) PRIMARY KEY,
  customer_id VARCHAR(64) NOT NULL REFERENCES delivery_customers(id) ON DELETE CASCADE,
  street VARCHAR(255) NOT NULL,
  number VARCHAR(64) NOT NULL,
  complement VARCHAR(128),
  neighborhood VARCHAR(128) NOT NULL,
  city VARCHAR(128) NOT NULL DEFAULT 'Santa Inês',
  reference TEXT,
  delivery_zone_id VARCHAR(64) REFERENCES delivery_zones(id),
  is_default BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS cost_centers (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS financial_categories (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(32) NOT NULL,
  parent_id VARCHAR(64) REFERENCES financial_categories(id),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS financial_accounts (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(32) NOT NULL,
  bank_name VARCHAR(128),
  account_number VARCHAR(64),
  pix_key VARCHAR(128),
  current_balance_cents BIGINT NOT NULL DEFAULT 0,
  initial_balance_cents BIGINT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_orders (
  id VARCHAR(64) PRIMARY KEY,
  order_number INTEGER NOT NULL,
  order_id VARCHAR(64) NOT NULL REFERENCES orders(id),
  customer_id VARCHAR(64) NOT NULL REFERENCES delivery_customers(id),
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(64) NOT NULL,
  delivery_type VARCHAR(32) NOT NULL DEFAULT 'DELIVERY',
  origin VARCHAR(32) NOT NULL DEFAULT 'SITE_WEB',
  status VARCHAR(32) NOT NULL DEFAULT 'NOVO',
  delivery_address_json JSONB,
  delivery_zone_id VARCHAR(64) REFERENCES delivery_zones(id),
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
  items_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  payment_method_declared VARCHAR(32) NOT NULL,
  payment_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  change_for_cents INTEGER,
  courier_id VARCHAR(64) REFERENCES delivery_couriers(id),
  courier_name VARCHAR(255),
  courier_fee_cents INTEGER NOT NULL DEFAULT 0,
  estimated_delivery_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  settlement_id VARCHAR(64),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_settlements (
  id VARCHAR(64) PRIMARY KEY,
  courier_id VARCHAR(64) NOT NULL REFERENCES delivery_couriers(id),
  courier_name VARCHAR(255) NOT NULL,
  shift_id VARCHAR(64),
  financial_account_id VARCHAR(64) NOT NULL REFERENCES financial_accounts(id),
  delivery_order_ids_json JSONB NOT NULL,
  total_deliveries INTEGER NOT NULL DEFAULT 0,
  total_cash_collected_cents BIGINT NOT NULL DEFAULT 0,
  total_courier_fees_cents BIGINT NOT NULL DEFAULT 0,
  net_amount_settled_cents BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'SETTLED',
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_by_staff_id VARCHAR(64) NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  trade_name VARCHAR(255),
  document VARCHAR(64),
  email VARCHAR(255),
  phone VARCHAR(64),
  contact_person VARCHAR(128),
  category VARCHAR(128),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts_receivable (
  id VARCHAR(64) PRIMARY KEY,
  description TEXT NOT NULL,
  origin VARCHAR(32) NOT NULL,
  origin_reference_id VARCHAR(64),
  cost_center_id VARCHAR(64) NOT NULL REFERENCES cost_centers(id),
  category_id VARCHAR(64) NOT NULL REFERENCES financial_categories(id),
  total_amount_cents BIGINT NOT NULL,
  paid_amount_cents BIGINT NOT NULL DEFAULT 0,
  remaining_amount_cents BIGINT NOT NULL,
  accrual_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  customer_name VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts_payable (
  id VARCHAR(64) PRIMARY KEY,
  description TEXT NOT NULL,
  origin VARCHAR(32) NOT NULL,
  origin_reference_id VARCHAR(64),
  supplier_id VARCHAR(64) REFERENCES suppliers(id),
  supplier_name VARCHAR(255),
  cost_center_id VARCHAR(64) NOT NULL REFERENCES cost_centers(id),
  category_id VARCHAR(64) NOT NULL REFERENCES financial_categories(id),
  total_amount_cents BIGINT NOT NULL,
  paid_amount_cents BIGINT NOT NULL DEFAULT 0,
  remaining_amount_cents BIGINT NOT NULL,
  accrual_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  invoice_number VARCHAR(128),
  barcode VARCHAR(128),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_transactions (
  id VARCHAR(64) PRIMARY KEY,
  financial_account_id VARCHAR(64) NOT NULL REFERENCES financial_accounts(id),
  type VARCHAR(32) NOT NULL,
  category_id VARCHAR(64) REFERENCES financial_categories(id),
  cost_center_id VARCHAR(64) REFERENCES cost_centers(id),
  amount_cents BIGINT NOT NULL,
  payment_method VARCHAR(32) NOT NULL,
  reference_type VARCHAR(32) NOT NULL,
  reference_id VARCHAR(64),
  description TEXT NOT NULL,
  accrual_date DATE NOT NULL,
  settlement_date DATE NOT NULL,
  registered_by_staff_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_transfers (
  id VARCHAR(64) PRIMARY KEY,
  from_account_id VARCHAR(64) NOT NULL REFERENCES financial_accounts(id),
  to_account_id VARCHAR(64) NOT NULL REFERENCES financial_accounts(id),
  amount_cents BIGINT NOT NULL,
  reason TEXT NOT NULL,
  registered_by_staff_id VARCHAR(64) NOT NULL,
  transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id VARCHAR(64) PRIMARY KEY,
  invoice_number VARCHAR(128) NOT NULL,
  supplier_id VARCHAR(64) NOT NULL REFERENCES suppliers(id),
  supplier_name VARCHAR(255) NOT NULL,
  cost_center_id VARCHAR(64) NOT NULL REFERENCES cost_centers(id),
  issue_date DATE NOT NULL,
  total_amount_cents BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'CONFIRMED',
  accounts_payable_id VARCHAR(64) REFERENCES accounts_payable(id),
  stock_moved BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_invoice_items (
  id VARCHAR(64) PRIMARY KEY,
  invoice_id VARCHAR(64) NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL REFERENCES catalog_products(id),
  product_name VARCHAR(255) NOT NULL,
  unit_of_measure VARCHAR(32) NOT NULL DEFAULT 'UN',
  quantity NUMERIC(12, 3) NOT NULL,
  unit_cost_cents BIGINT NOT NULL,
  total_cost_cents BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_reconciliations (
  id VARCHAR(64) PRIMARY KEY,
  financial_account_id VARCHAR(64) NOT NULL REFERENCES financial_accounts(id),
  reconciliation_date DATE NOT NULL,
  system_calculated_balance_cents BIGINT NOT NULL,
  declared_physical_balance_cents BIGINT NOT NULL,
  difference_cents BIGINT NOT NULL,
  adjustment_transaction_id VARCHAR(64) REFERENCES financial_transactions(id),
  status VARCHAR(32) NOT NULL DEFAULT 'BALANCED',
  reconciled_by_staff_id VARCHAR(64) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
