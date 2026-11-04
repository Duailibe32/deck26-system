-- ============================================================================
-- DECK 26 — MIGRAÇÃO VERSIONADA LOCAL 0004 (SQLite 3 + WAL Mode)
-- Versão: 0004_stage5_hotel_pms
-- Objetivo: Gestão Hoteleira Completa (Hotel Auto Posto Milla)
--           Apartamentos (separação de Ocupação, Limpeza e Manutenção),
--           Hóspedes LGPD, Reservas com Proteção de Sobreposição [in, out),
--           Check-in/Check-out, Folio do Quarto (Débitos, Bar, Restaurante, Frigobar, Serviços),
--           Transferência de Comanda de Restaurante -> Folio (ROOM_CHARGE) sem dupla baixa de estoque,
--           Controle de Frigobar, Serviços Adicionais, Governança/Limpeza e Manutenção.
-- ============================================================================

-- 1. Expansão da Tabela de Apartamentos (hotel_rooms)
ALTER TABLE hotel_rooms ADD COLUMN floor_sector TEXT NOT NULL DEFAULT 'Térreo';
ALTER TABLE hotel_rooms ADD COLUMN max_guests INTEGER NOT NULL DEFAULT 2;
ALTER TABLE hotel_rooms ADD COLUMN bed_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hotel_rooms ADD COLUMN bed_configuration TEXT NOT NULL DEFAULT '1 Cama Casal';
ALTER TABLE hotel_rooms ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE hotel_rooms ADD COLUMN amenities_json TEXT NOT NULL DEFAULT '["Ar Condicionado", "Wi-Fi", "TV Smart", "Frigobar"]';
ALTER TABLE hotel_rooms ADD COLUMN occupancy_status TEXT NOT NULL DEFAULT 'LIVRE';
ALTER TABLE hotel_rooms ADD COLUMN housekeeping_status TEXT NOT NULL DEFAULT 'LIMPO';
ALTER TABLE hotel_rooms ADD COLUMN maintenance_status TEXT NOT NULL DEFAULT 'DISPONIVEL';
ALTER TABLE hotel_rooms ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hotel_rooms ADD COLUMN current_guest_id TEXT;
ALTER TABLE hotel_rooms ADD COLUMN active_stay_id TEXT;
ALTER TABLE hotel_rooms ADD COLUMN internal_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE hotel_rooms ADD COLUMN created_at TEXT NOT NULL DEFAULT '2026-11-04T00:00:00.000Z';

-- 2. Cadastro Seguro de Hóspedes (hotel_guests) com Auditoria e LGPD
CREATE TABLE IF NOT EXISTS hotel_guests (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'CPF',
  document_number TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  nationality TEXT NOT NULL DEFAULT 'Brasileira',
  birth_date TEXT,
  address_street TEXT DEFAULT '',
  address_number TEXT DEFAULT '',
  address_neighborhood TEXT DEFAULT '',
  address_city TEXT DEFAULT '',
  address_state TEXT DEFAULT '',
  address_postal_code TEXT DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  total_stays_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hotel_guests_document ON hotel_guests(document_number);
CREATE INDEX IF NOT EXISTS idx_hotel_guests_name ON hotel_guests(full_name);

-- 3. Reservas com Bloqueio de Concorrência e Intervalos Inclusivo/Exclusivo
CREATE TABLE IF NOT EXISTS hotel_reservations (
  id TEXT PRIMARY KEY,
  reservation_code TEXT NOT NULL UNIQUE,
  guest_id TEXT NOT NULL REFERENCES hotel_guests(id),
  guest_name TEXT NOT NULL,
  guest_phone TEXT NOT NULL DEFAULT '',
  room_id TEXT REFERENCES hotel_rooms(id),
  room_number TEXT NOT NULL,
  room_category TEXT NOT NULL,
  guests_count INTEGER NOT NULL DEFAULT 1,
  check_in_date TEXT NOT NULL,
  check_out_date TEXT NOT NULL,
  daily_rate_cents INTEGER NOT NULL,
  estimated_total_cents INTEGER NOT NULL,
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  deposit_paid INTEGER NOT NULL DEFAULT 0,
  source_channel TEXT NOT NULL DEFAULT 'BALCAO',
  status TEXT NOT NULL DEFAULT 'CONFIRMADA' CHECK (status IN ('PENDENTE', 'CONFIRMADA', 'CHECK_IN_REALIZADO', 'CANCELADA', 'NO_SHOW', 'CONCLUIDA')),
  cancellation_reason TEXT,
  cancelled_at TEXT,
  cancelled_by_user_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_room_dates ON hotel_reservations(room_number, check_in_date, check_out_date, status);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_guest ON hotel_reservations(guest_id);

-- 4. Hospedagens / Estadias (hotel_stays)
CREATE TABLE IF NOT EXISTS hotel_stays (
  id TEXT PRIMARY KEY,
  stay_code TEXT NOT NULL UNIQUE,
  reservation_id TEXT REFERENCES hotel_reservations(id),
  room_id TEXT NOT NULL REFERENCES hotel_rooms(id),
  room_number TEXT NOT NULL,
  guest_id TEXT NOT NULL REFERENCES hotel_guests(id),
  guest_name TEXT NOT NULL,
  guest_document TEXT NOT NULL,
  companions_json TEXT NOT NULL DEFAULT '[]',
  check_in_at TEXT NOT NULL,
  check_out_scheduled_at TEXT NOT NULL,
  check_out_actual_at TEXT,
  daily_rate_cents INTEGER NOT NULL,
  nights_count INTEGER NOT NULL DEFAULT 1,
  early_checkin_cents INTEGER NOT NULL DEFAULT 0,
  late_checkout_cents INTEGER NOT NULL DEFAULT 0,
  extra_guests_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  discount_reason TEXT,
  tab_id TEXT NOT NULL REFERENCES tabs(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CHECKED_OUT', 'CANCELLED')),
  opened_by_user_id TEXT NOT NULL,
  closed_by_user_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hotel_stays_room ON hotel_stays(room_number, status);
CREATE INDEX IF NOT EXISTS idx_hotel_stays_guest ON hotel_stays(guest_id);
CREATE INDEX IF NOT EXISTS idx_hotel_stays_tab ON hotel_stays(tab_id);

-- 5. Lançamentos Auditáveis no Folio / Extrato da Hospedagem (hotel_folio_entries)
CREATE TABLE IF NOT EXISTS hotel_folio_entries (
  id TEXT PRIMARY KEY,
  stay_id TEXT NOT NULL REFERENCES hotel_stays(id),
  tab_id TEXT NOT NULL REFERENCES tabs(id),
  room_number TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('ROOM_RATE', 'RESTAURANT_ORDER', 'BAR_ORDER', 'MINIBAR', 'SERVICE', 'DISCOUNT', 'ADVANCE_PAYMENT', 'PAYMENT', 'ADJUSTMENT', 'REFUND')),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  source_reference_type TEXT,
  source_reference_id TEXT,
  source_details_json TEXT,
  operator_user_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hotel_folio_stay ON hotel_folio_entries(stay_id);
CREATE INDEX IF NOT EXISTS idx_hotel_folio_tab ON hotel_folio_entries(tab_id);

-- 6. Frigobar (Itens e Consumos)
CREATE TABLE IF NOT EXISTS hotel_minibar_items (
  id TEXT PRIMARY KEY,
  room_number TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES catalog_products(id),
  product_name TEXT NOT NULL,
  initial_quantity INTEGER NOT NULL DEFAULT 0,
  current_quantity INTEGER NOT NULL DEFAULT 0,
  unit_price_cents INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(room_number, product_id)
);

CREATE TABLE IF NOT EXISTS hotel_minibar_consumptions (
  id TEXT PRIMARY KEY,
  stay_id TEXT NOT NULL REFERENCES hotel_stays(id),
  room_number TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES catalog_products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('CONSUMPTION', 'RESTOCK', 'LOSS', 'AUDIT_CORRECTION')),
  folio_entry_id TEXT REFERENCES hotel_folio_entries(id),
  recorded_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hotel_minibar_stay ON hotel_minibar_consumptions(stay_id);

-- 7. Serviços Adicionais (Lavanderia, Estacionamento, Café, etc.)
CREATE TABLE IF NOT EXISTS hotel_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'GERAL' CHECK (category IN ('LAVANDERIA', 'CAFE_MANHA', 'ESTACIONAMENTO', 'CAMA_EXTRA', 'GERAL')),
  default_price_cents INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hotel_service_orders (
  id TEXT PRIMARY KEY,
  stay_id TEXT NOT NULL REFERENCES hotel_stays(id),
  service_id TEXT NOT NULL REFERENCES hotel_services(id),
  service_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  folio_entry_id TEXT REFERENCES hotel_folio_entries(id),
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  operator_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hotel_service_orders_stay ON hotel_service_orders(stay_id);

-- 8. Governança e Histórico de Limpeza (hotel_housekeeping_logs)
CREATE TABLE IF NOT EXISTS hotel_housekeeping_logs (
  id TEXT PRIMARY KEY,
  room_number TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('SET_DIRTY', 'START_CLEANING', 'FINISH_CLEANING', 'REQUEST_INSPECTION', 'APPROVE_INSPECTION', 'REJECT_INSPECTION')),
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  attendant_user_id TEXT NOT NULL,
  attendant_name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hotel_housekeeping_room ON hotel_housekeeping_logs(room_number);

-- 9. Manutenção de Apartamentos (hotel_maintenance_records)
CREATE TABLE IF NOT EXISTS hotel_maintenance_records (
  id TEXT PRIMARY KEY,
  room_number TEXT NOT NULL,
  issue_description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  maintenance_status TEXT NOT NULL DEFAULT 'EM_MANUTENCAO' CHECK (maintenance_status IN ('EM_MANUTENCAO', 'INTERDITADO', 'RESOLVED')),
  reported_by_user_id TEXT NOT NULL,
  reported_by_name TEXT NOT NULL,
  assigned_to TEXT NOT NULL DEFAULT '',
  resolution_notes TEXT NOT NULL DEFAULT '',
  resolved_by_user_id TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hotel_maintenance_room ON hotel_maintenance_records(room_number, maintenance_status);
