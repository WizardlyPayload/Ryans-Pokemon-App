import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Pool } from "pg";

const DOCKER_SCHEMA = "/app/migrations/001_init.sql";

function resolveSchemaSqlPath(): string {
  if (process.env.SCHEMA_SQL_PATH) return process.env.SCHEMA_SQL_PATH;
  if (existsSync(DOCKER_SCHEMA)) return DOCKER_SCHEMA;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../../migrations/001_init.sql");
}

/** Idempotent CREATE IF NOT EXISTS — runs before serving (initdb.d skips existing volumes). */
export async function ensureSchema(pool: Pool): Promise<void> {
  const sql = readFileSync(resolveSchemaSqlPath(), "utf8");
  await pool.query(sql);
}
