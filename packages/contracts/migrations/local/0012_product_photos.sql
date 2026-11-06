CREATE TABLE IF NOT EXISTS product_photos(
 product_id TEXT PRIMARY KEY REFERENCES catalog_products(id),
 digest TEXT NOT NULL UNIQUE,
 jpeg BLOB NOT NULL,
 updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES('0012_product_photos',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
