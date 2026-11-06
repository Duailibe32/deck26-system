CREATE TABLE IF NOT EXISTS pos_command_receipts (
 idempotency_key TEXT PRIMARY KEY,
 request_hash TEXT NOT NULL,
 initiator_id TEXT NOT NULL REFERENCES users(id),
 authorized_by_id TEXT NOT NULL REFERENCES users(id),
 result_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES('0010_pos_workspace',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE IF NOT EXISTS table_service_calls (
 id TEXT PRIMARY KEY,
 table_number INTEGER NOT NULL REFERENCES dining_tables_qr(table_number),
 tab_id TEXT NOT NULL REFERENCES tabs(id),
 kind TEXT NOT NULL CHECK(kind IN ('WAITER','BILL')),
 payment_preference TEXT CHECK(payment_preference IN ('PIX','CARD') OR payment_preference IS NULL),
 requested_at TEXT NOT NULL,
 resolved_at TEXT,
 resolved_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS table_service_call_open ON table_service_calls(table_number,tab_id,kind) WHERE resolved_at IS NULL;
