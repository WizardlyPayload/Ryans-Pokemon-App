import Fastify from "fastify";
import pg from "pg";
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
    if (!url.startsWith("/v1/"))
        return;
    const h = request.headers.authorization;
    const token = typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : "";
    if (token !== API_KEY) {
        return reply.code(401).send({ error: "unauthorized" });
    }
});
app.get("/health", async () => ({ ok: true, service: "ebay-history-api" }));
app.get("/v1/search", async (request) => {
    const q = String(request.query.q || "").trim();
    if (!q || q.length > 200) {
        return { query: q, results: [] };
    }
    const pattern = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    const r = await pool.query(`SELECT DISTINCT ON (o.ebay_item_id)
       o.ebay_item_id::text AS ebay_item_id,
       o.title,
       o.price_text,
       o.market,
       o.observed_at,
       o.page_url
     FROM listing_observations o
     WHERE o.title ILIKE $1 ESCAPE '\\'
     ORDER BY o.ebay_item_id, o.observed_at DESC
     LIMIT 50`, [pattern]);
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
});
app.get("/v1/item/:id/history", async (request, reply) => {
    const raw = request.params.id.replace(/\D/g, "");
    if (!raw || raw.length < 10) {
        return reply.code(400).send({ error: "invalid item id" });
    }
    const r = await pool.query(`SELECT
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
     LIMIT 200`, [raw]);
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
    await app.listen({ host: "0.0.0.0", port: PORT });
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
