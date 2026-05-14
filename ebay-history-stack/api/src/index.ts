import Fastify from "fastify";
import pg from "pg";
import { ensureSchema } from "./schema.js";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const API_KEY = process.env.API_KEY;
const PORT = Number(process.env.PORT || 3001);

if (!DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
if (!API_KEY) {
  console.error("API_KEY required");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

const app = Fastify({ logger: true });

app.addHook("preHandler", async (request, reply) => {
  const url = request.url.split("?")[0];
  if (!url.startsWith("/v1/")) return;
  const h = request.headers.authorization;
  const token = typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : "";
  if (token !== API_KEY) {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

app.get("/health", async () => ({
  ok: true,
  service: "ebay-history-api",
  features: ["ebay-history", "pricecharting-scrape"],
}));

async function ebaySearchResults(q: string) {
  const pattern = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
  const r = await pool.query(
    `SELECT DISTINCT ON (o.ebay_item_id)
       o.ebay_item_id::text AS ebay_item_id,
       o.title,
       o.price_text,
       o.market,
       o.observed_at,
       o.page_url
     FROM listing_observations o
     WHERE o.title ILIKE $1 ESCAPE '\\'
     ORDER BY o.ebay_item_id, o.observed_at DESC
     LIMIT 50`,
    [pattern],
  );
  return {
    query: q,
    results: r.rows.map((row) => ({
      ebayItemId: row.ebay_item_id,
      title: row.title,
      priceDisplay: row.price_text,
      market: row.market,
      observedAt: row.observed_at,
      pageUrl: row.page_url,
    })),
  };
}

function likePattern(q: string) {
  return `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
}

const PRICE_NUMERIC_SQL = `NULLIF(
  REPLACE(
    SUBSTRING(o.price_text FROM '([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)'),
    ',',
    ''
  ),
  ''
)::numeric`;

app.get("/v1/pc/search", async (request) => {
  const q = String((request.query as { q?: string }).q || "").trim();
  if (!q || q.length > 200) {
    return { query: q, results: [] };
  }
  const pattern = likePattern(q);
  const r = await pool.query(
    `SELECT
       p.pc_product_id::text AS "pcProductId",
       p.title,
       p.console_or_category AS "consoleOrCategory",
       p.product_url AS "productUrl",
       p.image_url AS "imageUrl",
       p.card_number AS "cardNumber",
       p.release_date AS "releaseDate",
       p.publisher,
       p.card_variant AS "cardVariant",
       p.population_summary AS "populationSummary",
       s.tiers,
       s.observed_at AS "snapshotAt",
       s.parse_version AS "parseVersion"
     FROM pc_products p
     LEFT JOIN LATERAL (
       SELECT tiers, observed_at, parse_version
       FROM pc_price_snapshots
       WHERE pc_product_id = p.pc_product_id
       ORDER BY observed_at DESC
       LIMIT 1
     ) s ON true
     WHERE p.title ILIKE $1 ESCAPE '\\'
        OR p.console_or_category ILIKE $1 ESCAPE '\\'
        OR p.card_number ILIKE $1 ESCAPE '\\'
        OR p.publisher ILIKE $1 ESCAPE '\\'
        OR (p.card_variant IS NOT NULL AND p.card_variant ILIKE $1 ESCAPE '\\')
        OR (p.population_summary IS NOT NULL AND p.population_summary::text ILIKE $1 ESCAPE '\\')
     ORDER BY p.last_seen_at DESC
     LIMIT 50`,
    [pattern],
  );
  return {
    query: q,
    results: r.rows,
  };
});

app.get<{ Params: { id: string } }>("/v1/pc/product/:id", async (request, reply) => {
  const raw = request.params.id.replace(/\D/g, "");
  if (!raw) {
    return reply.code(400).send({ error: "invalid product id" });
  }
  const p = await pool.query(
    `SELECT
       pc_product_id::text AS "pcProductId",
       title,
       console_or_category AS "consoleOrCategory",
       product_url AS "productUrl",
       image_url AS "imageUrl",
       card_number AS "cardNumber",
       release_date AS "releaseDate",
       publisher,
       card_variant AS "cardVariant",
       population_summary AS "populationSummary",
       first_seen_at AS "firstSeenAt",
       last_seen_at AS "lastSeenAt"
     FROM pc_products WHERE pc_product_id = $1::bigint`,
    [raw],
  );
  if (p.rows.length === 0) {
    return reply.code(404).send({ error: "not found" });
  }
  const s = await pool.query(
    `SELECT tiers, extras, observed_at AS "observedAt", parse_version AS "parseVersion"
     FROM pc_price_snapshots WHERE pc_product_id = $1::bigint
     ORDER BY observed_at DESC LIMIT 1`,
    [raw],
  );
  return {
    product: p.rows[0],
    latestSnapshot: s.rows[0] ?? null,
  };
});

app.get("/v1/compare", async (request) => {
  const q = String((request.query as { q?: string }).q || "").trim();
  if (!q || q.length > 200) {
    return {
      query: q,
      pricecharting: { query: q, results: [] },
      ebay: { query: q, results: [] },
    };
  }
  const pattern = likePattern(q);
  const pcR = await pool.query(
    `SELECT
       p.pc_product_id::text AS "pcProductId",
       p.title,
       p.console_or_category AS "consoleOrCategory",
       p.product_url AS "productUrl",
       p.image_url AS "imageUrl",
       p.card_number AS "cardNumber",
       p.release_date AS "releaseDate",
       p.publisher,
       p.card_variant AS "cardVariant",
       p.population_summary AS "populationSummary",
       s.tiers,
       s.observed_at AS "snapshotAt",
       s.parse_version AS "parseVersion"
     FROM pc_products p
     LEFT JOIN LATERAL (
       SELECT tiers, observed_at, parse_version
       FROM pc_price_snapshots
       WHERE pc_product_id = p.pc_product_id
       ORDER BY observed_at DESC
       LIMIT 1
     ) s ON true
     WHERE p.title ILIKE $1 ESCAPE '\\'
        OR p.console_or_category ILIKE $1 ESCAPE '\\'
        OR p.card_number ILIKE $1 ESCAPE '\\'
        OR p.publisher ILIKE $1 ESCAPE '\\'
        OR (p.card_variant IS NOT NULL AND p.card_variant ILIKE $1 ESCAPE '\\')
        OR (p.population_summary IS NOT NULL AND p.population_summary::text ILIKE $1 ESCAPE '\\')
     ORDER BY p.last_seen_at DESC
     LIMIT 50`,
    [pattern],
  );
  const ebay = await ebaySearchResults(q);
  return {
    query: q,
    pricecharting: { query: q, results: pcR.rows },
    ebay,
  };
});

app.get("/v1/search", async (request) => {
  const q = String((request.query as { q?: string }).q || "").trim();
  if (!q || q.length > 200) {
    return { query: q, results: [] };
  }
  return ebaySearchResults(q);
});

app.get("/v1/unified-search", async (request) => {
  const q = String((request.query as { q?: string }).q || "").trim();
  if (!q || q.length > 200) {
    return {
      query: q,
      product: null,
      latestSnapshot: null,
      ebayRecentSales: [],
      ebayAverageLast30: null,
      ebayAverageLast30Count: 0,
    };
  }
  const pattern = likePattern(q);

  const productQ = await pool.query(
    `SELECT
       p.pc_product_id::text AS "pcProductId",
       p.title,
       p.console_or_category AS "consoleOrCategory",
       p.product_url AS "productUrl",
       p.image_url AS "imageUrl",
       p.card_number AS "cardNumber",
       p.release_date AS "releaseDate",
       p.publisher,
       p.card_variant AS "cardVariant",
       p.population_summary AS "populationSummary",
       p.first_seen_at AS "firstSeenAt",
       p.last_seen_at AS "lastSeenAt"
     FROM pc_products p
     WHERE p.title ILIKE $1 ESCAPE '\\'
        OR p.console_or_category ILIKE $1 ESCAPE '\\'
        OR p.card_number ILIKE $1 ESCAPE '\\'
        OR p.publisher ILIKE $1 ESCAPE '\\'
        OR (p.card_variant IS NOT NULL AND p.card_variant ILIKE $1 ESCAPE '\\')
        OR (p.population_summary IS NOT NULL AND p.population_summary::text ILIKE $1 ESCAPE '\\')
     ORDER BY p.last_seen_at DESC
     LIMIT 1`,
    [pattern],
  );
  const product = productQ.rows[0] ?? null;

  let latestSnapshot: {
    tiers: unknown;
    extras: unknown;
    observedAt: string | null;
    parseVersion: string | null;
  } | null = null;
  if (product?.pcProductId) {
    /** `tiers` / grades are written only when pc-crawler visits each card's PriceCharting product page (`product_url`), not from search HTML. */
    const snapQ = await pool.query(
      `SELECT
         tiers,
         extras,
         observed_at AS "observedAt",
         parse_version AS "parseVersion"
       FROM pc_price_snapshots
       WHERE pc_product_id = $1::bigint
       ORDER BY observed_at DESC
       LIMIT 1`,
      [product.pcProductId],
    );
    latestSnapshot = snapQ.rows[0] ?? null;
  }

  /** Last 20 crawler observations for this title match (newest first). Price may be null if not captured. */
  const recentQ = await pool.query(
    `SELECT
       o.ebay_item_id::text AS "ebayItemId",
       o.title,
       o.price_text AS "priceDisplay",
       (${PRICE_NUMERIC_SQL})::double precision AS "priceValue",
       o.market,
       o.observed_at AS "observedAt",
       o.page_url AS "pageUrl"
     FROM listing_observations o
     WHERE o.title ILIKE $1 ESCAPE '\\'
     ORDER BY o.observed_at DESC NULLS LAST
     LIMIT 20`,
    [pattern],
  );

  const avgQ = await pool.query(
    `SELECT
       COUNT(*)::int AS "count",
       AVG(${PRICE_NUMERIC_SQL})::numeric(12,2) AS "avg"
     FROM (
       SELECT o.price_text
       FROM listing_observations o
       WHERE o.title ILIKE $1 ESCAPE '\\'
         AND ${PRICE_NUMERIC_SQL} IS NOT NULL
       ORDER BY o.observed_at DESC NULLS LAST
       LIMIT 20
     ) o`,
    [pattern],
  );
  const avgRow = avgQ.rows[0] as { count: number; avg: string | null };

  return {
    query: q,
    product,
    latestSnapshot,
    ebayRecentSales: recentQ.rows,
    ebayAverageLast30: avgRow?.avg != null ? Number(avgRow.avg) : null,
    ebayAverageLast30Count: avgRow?.count ?? 0,
  };
});

app.get<{ Params: { id: string } }>("/v1/item/:id/history", async (request, reply) => {
  const raw = request.params.id.replace(/\D/g, "");
  if (!raw || raw.length < 10) {
    return reply.code(400).send({ error: "invalid item id" });
  }
  const r = await pool.query(
    `SELECT
       o.ebay_item_id::text AS ebay_item_id,
       o.title,
       o.price_text,
       o.subtitle_or_caption,
       o.market,
       o.observed_at,
       o.thumb_url,
       o.page_url
     FROM listing_observations o
     WHERE o.ebay_item_id = $1::bigint
     ORDER BY o.observed_at DESC
     LIMIT 200`,
    [raw],
  );
  return {
    ebayItemId: raw,
    history: r.rows.map((row) => ({
      ebayItemId: row.ebay_item_id,
      title: row.title,
      priceDisplay: row.price_text,
      detail: row.subtitle_or_caption,
      market: row.market,
      observedAt: row.observed_at,
      thumbnailUrl: row.thumb_url,
      pageUrl: row.page_url,
    })),
  };
});

async function main() {
  await ensureSchema(pool);
  await app.listen({ host: "0.0.0.0", port: PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
