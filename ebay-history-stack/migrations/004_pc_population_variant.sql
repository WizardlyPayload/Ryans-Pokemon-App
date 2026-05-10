-- Optional structured fields from PriceCharting detail rows (population reports, variant text).

ALTER TABLE pc_products ADD COLUMN IF NOT EXISTS card_variant TEXT;
ALTER TABLE pc_products ADD COLUMN IF NOT EXISTS population_summary JSONB;

CREATE INDEX IF NOT EXISTS idx_pc_products_card_variant ON pc_products (card_variant)
  WHERE card_variant IS NOT NULL;
