import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Pool } from "pg";

const DOCKER_SCHEMA = "/app/migrations/001_init.sql";

/** Arbitrary lock keys — serialize migration when api + crawler start together. */
const ADV_LOCK_K1 = 8129347;
const ADV_LOCK_K2 = 291834;

function resolveSchemaSqlPath(): string {
  if (process.env.SCHEMA_SQL_PATH) return process.env.SCHEMA_SQL_PATH;
  if (existsSync(DOCKER_SCHEMA)) return DOCKER_SCHEMA;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../../migrations/001_init.sql");
}

/** Split migration file into statements (001_init has no semicolons inside literals). */
function migrationStatements(raw: string): string[] {
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
 * One statement per query + transaction + advisory lock: avoids PG errors from batched
 * multi-statement strings and races between api and crawler on startup.
 */
export async function ensureSchema(pool: Pool): Promise<void> {
  const sql = readFileSync(resolveSchemaSqlPath(), "utf8");
  const statements = migrationStatements(sql);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [ADV_LOCK_K1, ADV_LOCK_K2]);
    for (const stmt of statements) {
      await client.query(`${stmt};`);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
