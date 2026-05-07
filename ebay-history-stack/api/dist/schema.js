import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const MIGRATION_BASENAMES = ["001_init.sql", "002_pc_scrape.sql", "003_pc_product_metadata.sql"];
/** Arbitrary lock keys — serialize migration when api + crawler start together. */
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
/** Split migration file into statements (migrations have no semicolons inside literals). */
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
/**
 * Idempotent CREATE IF NOT EXISTS — runs before serving.
 * Applies migrations in order (001, 002, …).
 */
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
