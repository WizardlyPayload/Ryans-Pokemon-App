import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
const { Pool } = pg;
const MIGRATION_BASENAMES = [
    "001_init.sql",
    "002_pc_scrape.sql",
    "003_pc_product_metadata.sql",
    "004_pc_population_variant.sql",
];
const ADV_LOCK_K1 = 8129347;
const ADV_LOCK_K2 = 291834;
function resolveMigrationPaths() {
    if (process.env.SCHEMA_SQL_PATH) {
        return [process.env.SCHEMA_SQL_PATH];
    }
    const dockerDir = "/app/migrations";
    if (existsSync(join(dockerDir, "001_init.sql"))) {
        return MIGRATION_BASENAMES.map((f) => join(dockerDir, f)).filter((p) => existsSync(p));
    }
    const here = dirname(fileURLToPath(import.meta.url));
    return MIGRATION_BASENAMES.map((f) => join(here, "../../migrations", f));
}
function migrationStatements(raw) {
    const noLineComments = raw
        .split("\n")
        .map((line) => (line.trimStart().startsWith("--") ? "" : line))
        .join("\n");
    return noLineComments
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}
export function createPool(url) {
    return new Pool({ connectionString: url });
}
/** Idempotent CREATE IF NOT EXISTS — runs before crawl loop (initdb.d skips existing volumes). */
export async function ensureSchema(pool) {
    const paths = resolveMigrationPaths();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1, $2)", [ADV_LOCK_K1, ADV_LOCK_K2]);
        for (const p of paths) {
            const sql = readFileSync(p, "utf8");
            const statements = migrationStatements(sql);
            for (const stmt of statements) {
                await client.query(`${stmt};`);
            }
        }
        await client.query("COMMIT");
    }
    catch (e) {
        await client.query("ROLLBACK").catch(() => { });
        throw e;
    }
    finally {
        client.release();
    }
}
export async function ensureBudgetRow(pool, day) {
    await pool.query(`INSERT INTO crawl_budget_daily (day, pages_total, us_pages, uk_pages)
     VALUES ($1::date, 0, 0, 0)
     ON CONFLICT (day) DO NOTHING`, [day]);
}
export async function getBudget(pool, day) {
    const r = await pool.query(`SELECT pages_total, us_pages, uk_pages FROM crawl_budget_daily WHERE day = $1::date`, [day]);
    if (r.rows.length === 0) {
        return { pages_total: 0, us_pages: 0, uk_pages: 0 };
    }
    return {
        pages_total: r.rows[0].pages_total,
        us_pages: r.rows[0].us_pages,
        uk_pages: r.rows[0].uk_pages,
    };
}
export async function incrementBudget(pool, day, market) {
    await pool.query(`UPDATE crawl_budget_daily
     SET pages_total = pages_total + 1,
         us_pages = us_pages + CASE WHEN $2::text = 'us' THEN 1 ELSE 0 END,
         uk_pages = uk_pages + CASE WHEN $2::text = 'uk' THEN 1 ELSE 0 END,
         updated_at = now()
     WHERE day = $1::date`, [day, market]);
}
export async function getCrawlPage(pool, market, seedKey) {
    const r = await pool.query(`SELECT last_page FROM crawl_state WHERE market = $1 AND seed_key = $2`, [market, seedKey]);
    if (r.rows.length === 0)
        return 0;
    return r.rows[0].last_page ?? 0;
}
export async function setCrawlPage(pool, market, seedKey, page) {
    await pool.query(`INSERT INTO crawl_state (market, seed_key, last_page, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (market, seed_key) DO UPDATE SET last_page = $3, updated_at = now()`, [market, seedKey, page]);
}
export async function logEvent(pool, market, eventType, detail) {
    await pool.query(`INSERT INTO crawl_events (market, event_type, detail) VALUES ($1, $2, $3::jsonb)`, [
        market,
        eventType,
        JSON.stringify(detail),
    ]);
}
export async function upsertObservations(pool, market, rows, parseVersion) {
    let n = 0;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (const row of rows) {
            await client.query(`INSERT INTO items (ebay_item_id, market, first_seen_at, last_seen_at, last_title, last_url)
         VALUES ($1::bigint, $2, now(), now(), $3, $4)
         ON CONFLICT (ebay_item_id) DO UPDATE SET
           last_seen_at = now(),
           last_title = EXCLUDED.last_title,
           last_url = EXCLUDED.last_url`, [row.itemId, market, row.title, row.itemUrl]);
            await client.query(`INSERT INTO listing_observations
          (ebay_item_id, market, observed_at, price_text, currency_guess, title, subtitle_or_caption, thumb_url, page_url, parse_version)
         VALUES ($1::bigint, $2, now(), $3, $4, $5, $6, $7, $8, $9)`, [
                row.itemId,
                market,
                row.priceText || null,
                guessCurrency(row.priceText),
                row.title,
                row.caption || null,
                row.thumbUrl || null,
                row.pageUrl,
                parseVersion,
            ]);
            n += 1;
        }
        await client.query("COMMIT");
    }
    catch (e) {
        await client.query("ROLLBACK");
        throw e;
    }
    finally {
        client.release();
    }
    return n;
}
function guessCurrency(priceText) {
    if (!priceText)
        return null;
    if (priceText.includes("£"))
        return "GBP";
    if (priceText.includes("$"))
        return "USD";
    return null;
}
