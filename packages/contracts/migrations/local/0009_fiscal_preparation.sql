CREATE TABLE IF NOT EXISTS fiscal_preparation_settings (
 segment TEXT PRIMARY KEY CHECK(segment IN ('RESTAURANT','HOTEL')),
 json TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fiscal_product_reviews (
 product_id TEXT PRIMARY KEY REFERENCES catalog_products(id),
 json TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fiscal_rehearsals (
 id TEXT PRIMARY KEY,
 idempotency_key TEXT NOT NULL UNIQUE,
 request_hash TEXT NOT NULL,
 scenario TEXT NOT NULL CHECK(scenario IN ('APPROVED','REJECTED','TIMEOUT','OFFLINE')),
 status TEXT NOT NULL CHECK(status IN ('REHEARSAL_APPROVED','REHEARSAL_REJECTED','UNKNOWN_OUTCOME','OFFLINE_REHEARSAL','CANCELED_REHEARSAL')),
 payload_json TEXT NOT NULL,
 history_json TEXT NOT NULL,
 actor_user_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES('0009_fiscal_preparation',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
