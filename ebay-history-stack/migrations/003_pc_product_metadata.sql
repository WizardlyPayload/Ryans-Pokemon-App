-- Structured metadata for scraped PriceCharting product pages (search + display).

ALTER TABLE pc_products ADD COLUMN IF NOT EXISTS card_number TEXT;
ALTER TABLE pc_products ADD COLUMN IF NOT EXISTS release_date DATE;
ALTER TABLE pc_products ADD COLUMN IF NOT EXISTS publisher TEXT;

CREATE INDEX IF NOT EXISTS idx_pc_products_card_number ON pc_products (card_number);
CREATE INDEX IF NOT EXISTS idx_pc_products_release_date ON pc_products (release_date);

CREATE INDEX IF NOT EXISTS idx_pc_products_fts ON pc_products USING gin (
  to_tsvector(
    'english',
    coalesce(title, '') || ' ' ||
    coalesce(console_or_category, '') || ' ' ||
    coalesce(card_number, '') || ' ' ||
    coalesce(publisher, '')
  )
);
