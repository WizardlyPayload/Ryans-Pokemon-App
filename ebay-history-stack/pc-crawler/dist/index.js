import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { createPool, ensureSchema, upsertPcProduct } from "./db.js";
chromium.use(StealthPlugin());
const DATABASE_URL = process.env.DATABASE_URL;
const PC_CRAWLER_ENABLED = (process.env.PC_CRAWLER_ENABLED || "true").toLowerCase() === "true";
const PC_SEARCH_QUERY = (process.env.PC_SEARCH_QUERY || "pikachu").trim();
const PC_PRODUCTS_PER_RUN = Math.max(1, Number(process.env.PC_PRODUCTS_PER_RUN || 15));
const PC_MIN_DELAY_MS = Math.max(500, Number(process.env.PC_MIN_DELAY_MS || 3000));
const PC_MAX_DELAY_MS = Math.max(PC_MIN_DELAY_MS, Number(process.env.PC_MAX_DELAY_MS || 14000));
const PC_LOOP_INTERVAL_MS = Math.max(60_000, Number(process.env.PC_LOOP_INTERVAL_MS || 3_600_000));
const PARSE_VERSION = process.env.PARSE_VERSION || "1";
const PC_BASE = "https://www.pricecharting.com";
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function randBetween(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
}
function launchChromium() {
    return chromium.launch({
        headless: true,
        args: [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--window-size=1280,800",
        ],
    });
}
async function extractProductPage(page, productUrl) {
    return page.evaluate((url) => {
        const out = {
            id: null,
            title: "",
            console: null,
            image: document.querySelector('meta[property="og:image"]')?.getAttribute("content") || null,
            tierText: "",
        };
        const h1 = document.querySelector("h1");
        if (h1)
            out.title = (h1.textContent || "").trim();
        for (const a of document.querySelectorAll('a[href*="product="]')) {
            try {
                const u = new URL(a.href, location.origin);
                const p = u.searchParams.get("product");
                if (p && /^\d+$/.test(p)) {
                    out.id = p;
                    break;
                }
            }
            catch {
                /* skip */
            }
        }
        if (!out.id) {
            const m = document.documentElement.innerHTML.match(/product=(\d{4,})/);
            if (m)
                out.id = m[1];
        }
        const sub = document.querySelector(".product-details")?.querySelector("h2, .category") ||
            document.querySelector("[class*='console'], .subtitle");
        if (sub)
            out.console = (sub.textContent || "").trim().slice(0, 500) || null;
        const tables = [...document.querySelectorAll("table")];
        for (const t of tables) {
            const txt = t.innerText || "";
            if (/\$/.test(txt) && /Ungraded|Grade\s*\d|PSA\s*10/i.test(txt)) {
                out.tierText = txt.replace(/\s+/g, " ").trim().slice(0, 12000);
                break;
            }
        }
        return { ...out, url };
    }, productUrl);
}
async function collectGameLinks(page, searchUrl) {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await sleep(randBetween(800, 2000));
    const hrefs = await page.$$eval('a[href*="/game/"]', (anchors) => {
        const set = new Set();
        for (const a of anchors) {
            const h = a.href;
            if (h.includes("pricecharting.com") && /\/game\//.test(h)) {
                set.add(h.split("#")[0]);
            }
        }
        return [...set];
    });
    return hrefs;
}
async function runBatch(browser, pool) {
    const searchUrl = `${PC_BASE}/search-products?q=${encodeURIComponent(PC_SEARCH_QUERY)}`;
    const ctx = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
    });
    const page = await ctx.newPage();
    try {
        const links = await collectGameLinks(page, searchUrl);
        console.log(JSON.stringify({ msg: "pc_search_links", query: PC_SEARCH_QUERY, count: links.length }));
        const slice = links.slice(0, PC_PRODUCTS_PER_RUN);
        let stored = 0;
        for (const href of slice) {
            await sleep(randBetween(PC_MIN_DELAY_MS, PC_MAX_DELAY_MS));
            await page.goto(href, { waitUntil: "domcontentloaded", timeout: 90_000 });
            await sleep(randBetween(400, 1200));
            const data = await extractProductPage(page, href);
            if (!data.id) {
                console.log(JSON.stringify({ msg: "pc_skip_no_id", href }));
                continue;
            }
            const urlObj = new URL(href);
            const slug = urlObj.pathname.split("/").filter(Boolean).pop() || "";
            const tiers = { gridText: data.tierText };
            const extras = { sourceUrl: href };
            await upsertPcProduct(pool, {
                pcProductId: data.id,
                slug,
                productUrl: href,
                title: data.title || slug,
                consoleOrCategory: data.console,
                imageUrl: data.image,
                tiers,
                extras,
                parseVersion: PARSE_VERSION,
            });
            stored += 1;
            console.log(JSON.stringify({ msg: "pc_stored", pcProductId: data.id, title: data.title }));
        }
        console.log(JSON.stringify({ msg: "pc_batch_done", stored, attempted: slice.length }));
    }
    finally {
        await ctx.close();
    }
}
async function main() {
    if (!DATABASE_URL) {
        console.error("DATABASE_URL required");
        process.exit(1);
    }
    const pool = createPool(DATABASE_URL);
    await ensureSchema(pool);
    console.log(JSON.stringify({
        msg: "pc_crawler_start",
        enabled: PC_CRAWLER_ENABLED,
        searchQuery: PC_SEARCH_QUERY,
        productsPerRun: PC_PRODUCTS_PER_RUN,
        loopIntervalMs: PC_LOOP_INTERVAL_MS,
        parseVersion: PARSE_VERSION,
    }));
    let browser = await launchChromium();
    const shutdown = async () => {
        if (browser) {
            await browser.close();
            browser = null;
        }
        await pool.end();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    while (true) {
        if (!PC_CRAWLER_ENABLED) {
            await sleep(60_000);
            continue;
        }
        if (!browser) {
            browser = await launchChromium();
        }
        try {
            await runBatch(browser, pool);
        }
        catch (e) {
            console.error(JSON.stringify({ msg: "pc_batch_error", error: String(e) }));
            if (browser) {
                await browser.close();
                browser = null;
            }
        }
        await sleep(PC_LOOP_INTERVAL_MS);
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
