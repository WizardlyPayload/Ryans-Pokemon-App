import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
const { Pool } = pg;
const MIGRATION_BASENAMES = ["001_init.sql", "002_pc_scrape.sql", "003_pc_product_metadata.sql"];
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
export async function upsertPcProduct(pool, row) {
    await pool.query(`INSERT INTO pc_products (
       pc_product_id, slug, product_url, title, console_or_category, image_url,
       card_number, release_date, publisher, last_seen_at
     )
     VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8::date, $9, now())
     ON CONFLICT (pc_product_id) DO UPDATE SET
       slug = COALESCE(EXCLUDED.slug, pc_products.slug),
       product_url = EXCLUDED.product_url,
       title = EXCLUDED.title,
       console_or_category = COALESCE(EXCLUDED.console_or_category, pc_products.console_or_category),
       image_url = COALESCE(EXCLUDED.image_url, pc_products.image_url),
       card_number = COALESCE(EXCLUDED.card_number, pc_products.card_number),
       release_date = COALESCE(EXCLUDED.release_date, pc_products.release_date),
       publisher = COALESCE(EXCLUDED.publisher, pc_products.publisher),
       last_seen_at = now()`, [
        row.pcProductId,
        row.slug,
        row.productUrl,
        row.title,
        row.consoleOrCategory,
        row.imageUrl,
        row.cardNumber,
        row.releaseDate,
        row.publisher,
    ]);
    await pool.query(`INSERT INTO pc_price_snapshots (pc_product_id, tiers, extras, parse_version)
     VALUES ($1::bigint, $2::jsonb, $3::jsonb, $4)`, [row.pcProductId, JSON.stringify(row.tiers), JSON.stringify(row.extras), row.parseVersion]);
}
