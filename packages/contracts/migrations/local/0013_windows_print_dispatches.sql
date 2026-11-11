CREATE TABLE IF NOT EXISTS windows_print_dispatches (
  job_id TEXT NOT NULL REFERENCES print_jobs(id),
  copy_number INTEGER NOT NULL,
  printer_name TEXT NOT NULL,
  spool_id INTEGER,
  safe_retry INTEGER NOT NULL DEFAULT 0 CHECK (safe_retry IN (0,1)),
  PRIMARY KEY (job_id, copy_number)
);

INSERT OR IGNORE INTO schema_migrations(version,applied_at)
VALUES ('0013_windows_print_dispatches',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
