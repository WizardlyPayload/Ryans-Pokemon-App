-- eBay history crawler schema

CREATE TABLE IF NOT EXISTS items (
    ebay_item_id   BIGINT PRIMARY KEY,
    market         TEXT NOT NULL CHECK (market IN ('us', 'uk')),
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_title     TEXT,
    last_url       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_market_last ON items (market, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS listing_observations (
    id               BIGSERIAL PRIMARY KEY,
    ebay_item_id     BIGINT NOT NULL REFERENCES items (ebay_item_id) ON DELETE CASCADE,
    market           TEXT NOT NULL CHECK (market IN ('us', 'uk')),
    observed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    price_text       TEXT,
    currency_guess   TEXT,
    title            TEXT NOT NULL,
    subtitle_or_caption TEXT,
    thumb_url        TEXT,
    page_url         TEXT NOT NULL,
    parse_version    TEXT NOT NULL DEFAULT '1',
    raw_hash         TEXT
);

CREATE INDEX IF NOT EXISTS idx_obs_item_time ON listing_observations (ebay_item_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_market_time ON listing_observations (market, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_title_search ON listing_observations USING gin (to_tsvector('english', title));

CREATE TABLE IF NOT EXISTS crawl_state (
    market        TEXT NOT NULL CHECK (market IN ('us', 'uk')),
    seed_key      TEXT NOT NULL,
    last_page     INT NOT NULL DEFAULT 0,
    cursor_hint   TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (market, seed_key)
);

CREATE TABLE IF NOT EXISTS crawl_events (
    id           BIGSERIAL PRIMARY KEY,
    observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    market       TEXT,
    event_type   TEXT NOT NULL,
    detail       JSONB
);

CREATE INDEX IF NOT EXISTS idx_crawl_events_time ON crawl_events (observed_at DESC);

CREATE TABLE IF NOT EXISTS crawl_budget_daily (
    day           DATE PRIMARY KEY,
    pages_total   INT NOT NULL DEFAULT 0,
    us_pages      INT NOT NULL DEFAULT 0,
    uk_pages      INT NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
