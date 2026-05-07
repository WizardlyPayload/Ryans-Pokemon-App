-- PriceCharting HTML scrape cache (private VPS DB)

CREATE TABLE IF NOT EXISTS pc_products (
  pc_product_id BIGINT PRIMARY KEY,
  slug TEXT,
  product_url TEXT NOT NULL,
  title TEXT NOT NULL,
  console_or_category TEXT,
  image_url TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pc_products_title ON pc_products USING gin (to_tsvector('english', title));

CREATE TABLE IF NOT EXISTS pc_price_snapshots (
  id BIGSERIAL PRIMARY KEY,
  pc_product_id BIGINT NOT NULL REFERENCES pc_products (pc_product_id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tiers JSONB NOT NULL DEFAULT '{}'::jsonb,
  extras JSONB,
  parse_version TEXT NOT NULL DEFAULT '1',
  raw_snippet TEXT
);

CREATE INDEX IF NOT EXISTS idx_pc_snap_product_time ON pc_price_snapshots (pc_product_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS pc_crawl_state (
  seed_key TEXT NOT NULL,
  last_page INT NOT NULL DEFAULT 0,
  cursor_hint TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (seed_key)
);
