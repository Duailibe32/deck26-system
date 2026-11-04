-- ============================================================================
-- DECK 26 — MIGRAÇÃO VERSIONADA CLOUD 0004 (PostgreSQL 16+ — Hostinger VPS)
-- Versão: 0004_stage5_cloud_hotel_pms
-- Objetivo: Espelhar na nuvem as estruturas completas do Hotel Auto Posto Milla
--           Apartamentos, Hóspedes LGPD, Reservas, Estadias, Folio, Frigobar,
--           Serviços, Governança/Limpeza e Manutenção.
-- ============================================================================

-- 1. Expansão de hotel_rooms
CREATE TABLE IF NOT EXISTS hotel_rooms (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  daily_rate_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  current_guest_name TEXT,
  active_tab_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS floor_sector TEXT NOT NULL DEFAULT 'Térreo';
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS max_guests INTEGER NOT NULL DEFAULT 2;
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS bed_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS bed_configuration TEXT NOT NULL DEFAULT '1 Cama Casal';
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS amenities_json JSONB NOT NULL DEFAULT '["Ar Condicionado", "Wi-Fi", "TV Smart", "Frigobar"]'::jsonb;
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS occupancy_status TEXT NOT NULL DEFAULT 'LIVRE';
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS housekeeping_status TEXT NOT NULL DEFAULT 'LIMPO';
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS maintenance_status TEXT NOT NULL DEFAULT 'DISPONIVEL';
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS current_guest_id TEXT;
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS active_stay_id TEXT;
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS internal_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Hóspedes (hotel_guests)
CREATE TABLE IF NOT EXISTS hotel_guests (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'CPF',
  document_number TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  nationality TEXT NOT NULL DEFAULT 'Brasileira',
  birth_date DATE,
  address_street TEXT DEFAULT '',
  address_number TEXT DEFAULT '',
  address_neighborhood TEXT DEFAULT '',
  address_city TEXT DEFAULT '',
  address_state TEXT DEFAULT '',
  address_postal_code TEXT DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  total_stays_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cloud_hotel_guests_doc ON hotel_guests(document_number);

-- 3. Reservas (hotel_reservations)
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
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  daily_rate_cents INTEGER NOT NULL,
  estimated_total_cents INTEGER NOT NULL,
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  deposit_paid BOOLEAN NOT NULL DEFAULT FALSE,
  source_channel TEXT NOT NULL DEFAULT 'BALCAO',
  status TEXT NOT NULL DEFAULT 'CONFIRMADA',
  cancellation_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by_user_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Estadias (hotel_stays)
CREATE TABLE IF NOT EXISTS hotel_stays (
  id TEXT PRIMARY KEY,
  stay_code TEXT NOT NULL UNIQUE,
  reservation_id TEXT REFERENCES hotel_reservations(id),
  room_id TEXT NOT NULL REFERENCES hotel_rooms(id),
  room_number TEXT NOT NULL,
  guest_id TEXT NOT NULL REFERENCES hotel_guests(id),
  guest_name TEXT NOT NULL,
  guest_document TEXT NOT NULL,
  companions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  check_in_at TIMESTAMPTZ NOT NULL,
  check_out_scheduled_at TIMESTAMPTZ NOT NULL,
  check_out_actual_at TIMESTAMPTZ,
  daily_rate_cents INTEGER NOT NULL,
  nights_count INTEGER NOT NULL DEFAULT 1,
  early_checkin_cents INTEGER NOT NULL DEFAULT 0,
  late_checkout_cents INTEGER NOT NULL DEFAULT 0,
  extra_guests_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  discount_reason TEXT,
  tab_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  opened_by_user_id TEXT NOT NULL,
  closed_by_user_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Folio / Extrato (hotel_folio_entries)
CREATE TABLE IF NOT EXISTS hotel_folio_entries (
  id TEXT PRIMARY KEY,
  stay_id TEXT NOT NULL REFERENCES hotel_stays(id),
  tab_id UUID NOT NULL,
  room_number TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  source_reference_type TEXT,
  source_reference_id TEXT,
  source_details_json JSONB,
  operator_user_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Frigobar
CREATE TABLE IF NOT EXISTS hotel_minibar_items (
  id TEXT PRIMARY KEY,
  room_number TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  initial_quantity INTEGER NOT NULL DEFAULT 0,
  current_quantity INTEGER NOT NULL DEFAULT 0,
  unit_price_cents INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(room_number, product_id)
);

CREATE TABLE IF NOT EXISTS hotel_minibar_consumptions (
  id TEXT PRIMARY KEY,
  stay_id TEXT NOT NULL REFERENCES hotel_stays(id),
  room_number TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  movement_type TEXT NOT NULL,
  folio_entry_id TEXT,
  recorded_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Serviços Adicionais
CREATE TABLE IF NOT EXISTS hotel_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'GERAL',
  default_price_cents INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hotel_service_orders (
  id TEXT PRIMARY KEY,
  stay_id TEXT NOT NULL REFERENCES hotel_stays(id),
  service_id TEXT NOT NULL REFERENCES hotel_services(id),
  service_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  folio_entry_id TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  operator_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Governança
CREATE TABLE IF NOT EXISTS hotel_housekeeping_logs (
  id TEXT PRIMARY KEY,
  room_number TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  attendant_user_id TEXT NOT NULL,
  attendant_name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Manutenção
CREATE TABLE IF NOT EXISTS hotel_maintenance_records (
  id TEXT PRIMARY KEY,
  room_number TEXT NOT NULL,
  issue_description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  maintenance_status TEXT NOT NULL DEFAULT 'EM_MANUTENCAO',
  reported_by_user_id TEXT NOT NULL,
  reported_by_name TEXT NOT NULL,
  assigned_to TEXT NOT NULL DEFAULT '',
  resolution_notes TEXT NOT NULL DEFAULT '',
  resolved_by_user_id TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
