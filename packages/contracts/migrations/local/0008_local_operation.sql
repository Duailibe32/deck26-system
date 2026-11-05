CREATE TABLE IF NOT EXISTS operational_settings (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_session_revocations (user_id TEXT PRIMARY KEY REFERENCES users(id), revoked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS print_simulations (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES print_jobs(id), device TEXT NOT NULL CHECK(device IN ('CASHIER','KITCHEN')), width_mm INTEGER NOT NULL CHECK(width_mm IN (58,80)), payload_text TEXT NOT NULL, actor_user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, copy_number INTEGER NOT NULL DEFAULT 1, UNIQUE(job_id,copy_number));
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES ('0008_local_operation',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
