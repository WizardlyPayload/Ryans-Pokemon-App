import type { Browser, BrowserContext } from "playwright";
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
/** "prices" = price-guide search (card/product links). Set to "off" to omit. */
const PC_SEARCH_TYPE = (process.env.PC_SEARCH_TYPE ?? "prices").trim().toLowerCase();

const PC_BASE = "https://www.pricecharting.com";

function buildPcSearchUrl(query: string): string {
  const q = encodeURIComponent(query);
  if (!PC_SEARCH_TYPE || PC_SEARCH_TYPE === "off") {
    return `${PC_BASE}/search-products?q=${q}`;
  }
  return `${PC_BASE}/search-products?q=${q}&type=${encodeURIComponent(PC_SEARCH_TYPE)}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randBetween(a: number, b: number) {
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

async function extractProductPage(page: import("playwright").Page, productUrl: string) {
  return page.evaluate((url) => {
    const out: {
      id: string | null;
      title: string;
      console: string | null;
      image: string | null;
      tierText: string;
    } = {
      id: null,
      title: "",
      console: null,
      image: document.querySelector('meta[property="og:image"]')?.getAttribute("content") || null,
      tierText: "",
    };
    const h1 = document.querySelector("h1");
    if (h1) out.title = (h1.textContent || "").trim();
    for (const a of document.querySelectorAll('a[href*="product="]')) {
      try {
        const u = new URL((a as HTMLAnchorElement).href, location.origin);
        const p = u.searchParams.get("product");
        if (p && /^\d+$/.test(p)) {
          out.id = p;
          break;
        }
      } catch {
        /* skip */
      }
    }
    if (!out.id) {
      const m = document.documentElement.innerHTML.match(/product=(\d{4,})/);
      if (m) out.id = m[1]!;
    }
    const sub =
      document.querySelector(".product-details")?.querySelector("h2, .category") ||
      document.querySelector("[class*='console'], .subtitle");
    if (sub) out.console = (sub.textContent || "").trim().slice(0, 500) || null;

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

async function collectGameLinks(page: import("playwright").Page, searchUrl: string): Promise<string[]> {
  await page.goto(searchUrl, { waitUntil: "load", timeout: 90_000 });
  await sleep(randBetween(800, 2000));
  try {
    await page.waitForSelector('a[href*="/game/"]', { timeout: 60_000 });
  } catch {
    /* hydrate / bot page — try scroll + HTML fallback below */
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(randBetween(400, 1200));

  const hrefsFromDom = await page.$$eval("a[href]", (anchors) => {
    const set = new Set<string>();
    const origin = "https://www.pricecharting.com";
    for (const a of anchors) {
      const raw = (a as HTMLAnchorElement).getAttribute("href") || "";
      if (!raw.includes("/game/")) continue;
      try {
        const u = new URL(raw, origin);
        if (!u.hostname.endsWith("pricecharting.com")) continue;
        if (!u.pathname.includes("/game/")) continue;
        const canon = `${u.origin}${u.pathname}${u.search}`.split("#")[0]!;
        set.add(canon);
      } catch {
        /* skip */
      }
    }
    return [...set];
  });

  if (hrefsFromDom.length > 0) {
    return hrefsFromDom;
  }

  const html = await page.content();
  const fromHtml = new Set<string>();
  const absRe = /https?:\/\/(?:www\.)?pricecharting\.com\/game\/[^"'>\s]+/gi;
  let m: RegExpExecArray | null;
  while ((m = absRe.exec(html)) !== null) {
    fromHtml.add(m[0].replace(/&amp;/g, "&").split("#")[0]!);
  }
  const relRe = /(?:href|\shref)=["'](\/game\/[^"'#]+)/gi;
  while ((m = relRe.exec(html)) !== null) {
    const path = m[1]!.replace(/&amp;/g, "&");
    try {
      const u = new URL(path, PC_BASE);
      fromHtml.add(`${u.origin}${u.pathname}${u.search}`.split("#")[0]!);
    } catch {
      /* skip */
    }
  }

  if (fromHtml.size === 0) {
    const probe = await page.evaluate(() => ({
      title: document.title,
      anchorCount: document.querySelectorAll("a").length,
      bodyTextLen: (document.body?.innerText || "").length,
    }));
    console.log(
      JSON.stringify({
        msg: "pc_search_no_links",
        searchUrl,
        ...probe,
        hint:
          "No /game/ links in DOM or HTML. Often blocked/challenge page, or results still loading — check VPS IP / add wait.",
      }),
    );
  }

  return [...fromHtml];
}

async function runBatch(browser: Browser, pool: ReturnType<typeof createPool>) {
  const searchUrl = buildPcSearchUrl(PC_SEARCH_QUERY);
  const ctx: BrowserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  try {
    const links = await collectGameLinks(page, searchUrl);
    console.log(
      JSON.stringify({
        msg: "pc_search_links",
        query: PC_SEARCH_QUERY,
        searchUrl,
        searchType: PC_SEARCH_TYPE || null,
        count: links.length,
      }),
    );
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
      const tiers: Record<string, unknown> = { gridText: data.tierText };
      const extras: Record<string, unknown> = { sourceUrl: href };
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
  } finally {
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

  console.log(
    JSON.stringify({
      msg: "pc_crawler_start",
      enabled: PC_CRAWLER_ENABLED,
      searchQuery: PC_SEARCH_QUERY,
      searchType: PC_SEARCH_TYPE || null,
      productsPerRun: PC_PRODUCTS_PER_RUN,
      loopIntervalMs: PC_LOOP_INTERVAL_MS,
      parseVersion: PARSE_VERSION,
    }),
  );

  let browser: Browser | null = await launchChromium();
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
    } catch (e) {
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
