import type { Browser } from "playwright";
import { chromium } from "playwright";
import {
  createPool,
  incrementBudget,
  getBudget,
  ensureBudgetRow,
  getCrawlPage,
  setCrawlPage,
  upsertObservations,
  logEvent,
  type Market,
} from "./db.js";

const DATABASE_URL = process.env.DATABASE_URL;
const CRAWLER_ENABLED = (process.env.CRAWLER_ENABLED || "true").toLowerCase() === "true";
const GLOBAL_PAGES_PER_DAY = Math.max(1, Number(process.env.GLOBAL_PAGES_PER_DAY || 1000));
const US_SHARE = Math.min(1, Math.max(0, Number(process.env.US_SHARE ?? 0.5)));
const UK_SHARE = Math.min(1, Math.max(0, Number(process.env.UK_SHARE ?? 0.5)));
const MIN_DELAY_MS = Math.max(1000, Number(process.env.MIN_DELAY_MS || 8000));
const MAX_DELAY_MS = Math.max(MIN_DELAY_MS, Number(process.env.MAX_DELAY_MS || 45000));
const PARSE_VERSION = process.env.PARSE_VERSION || "1";
const US_SEED = process.env.US_SEED_URL || "https://www.ebay.com/sch/i.html?_sacat=31392&LH_Sold=1&LH_Complete=1&_ipg=60&rt=nc";
const UK_SEED = process.env.UK_SEED_URL || "https://www.ebay.co.uk/sch/i.html?_sacat=0&LH_Sold=1&LH_Complete=1&_ipg=60&rt=nc";

const SEED_KEY = "category_sold";

function botWall(html: string): boolean {
  const h = html.toLowerCase();
  return (
    h.includes("pardon our interruption") ||
    h.includes("verify you are human") ||
    h.includes("are you a robot") ||
    (h.includes("access denied") && h.includes("edgesuite"))
  );
}

function buildSearchUrl(seed: string, pageNum: number): string {
  const u = new URL(seed);
  if (pageNum > 0) {
    u.searchParams.set("_pgn", String(pageNum));
  } else {
    u.searchParams.delete("_pgn");
  }
  return u.toString();
}

function capsForDay(): { us: number; uk: number } {
  const sum = US_SHARE + UK_SHARE;
  const usRatio = sum > 0 ? US_SHARE / sum : 0.5;
  const ukRatio = sum > 0 ? UK_SHARE / sum : 0.5;
  return {
    us: Math.max(1, Math.floor(GLOBAL_PAGES_PER_DAY * usRatio)),
    uk: Math.max(1, Math.floor(GLOBAL_PAGES_PER_DAY * ukRatio)),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randBetween(a: number, b: number): number {
  return a + Math.floor(Math.random() * (b - a + 1));
}

type Row = {
  itemId: string;
  title: string;
  priceText: string;
  caption: string;
  thumbUrl: string;
  itemUrl: string;
  pageUrl: string;
};

async function fetchOnePage(browser: Browser, market: Market, seedUrl: string, pageNum: number): Promise<{ url: string; rows: Row[] }> {
  const ctx = await browser.newContext({
    locale: market === "uk" ? "en-GB" : "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  const url = buildSearchUrl(seedUrl, pageNum);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector("div.s-card[data-listingid]", { timeout: 45000 }).catch(() => {});
    const html = await page.content();
    if (botWall(html)) {
      throw new Error("bot_wall");
    }
    const rows = await page.evaluate(
      (pageUrlArg) => {
        const cards = Array.from(document.querySelectorAll("div.s-card[data-listingid]"));
        const out: Array<{
          itemId: string;
          title: string;
          priceText: string;
          caption: string;
          thumbUrl: string;
          itemUrl: string;
          pageUrl: string;
        }> = [];
        for (const card of cards) {
          const listingId = card.getAttribute("data-listingid") || "";
          const links = Array.from(card.querySelectorAll('a.s-card__link[href*="/itm/"]'));
          let href = "";
          let title = "";
          for (const a of links) {
            const el = a as HTMLAnchorElement;
            if (!href && el.href) href = el.href.split("?")[0];
            const isImg = el.classList.contains("image-treatment");
            const t = (el.textContent || "").trim();
            if (!isImg && t.length > 5 && !t.toLowerCase().startsWith("shop on ebay")) title = t;
          }
          const img = card.querySelector("img.s-card__image");
          if (!title && img) title = (img.getAttribute("alt") || "").trim();
          const priceEl = card.querySelector(".s-card__price");
          const cap = card.querySelector(".s-card__caption");
          const priceText = priceEl?.textContent?.trim() || "";
          const caption = cap?.textContent?.trim() || "";
          const thumbUrl = img?.getAttribute("src") || img?.getAttribute("data-src") || "";
          const cleanId = listingId.replace(/\D/g, "");
          if (!cleanId || !href || title.length < 5) continue;
          out.push({
            itemId: cleanId,
            title,
            priceText,
            caption,
            thumbUrl,
            itemUrl: href,
            pageUrl: pageUrlArg,
          });
        }
        return out;
      },
      url,
    );
    return { url, rows };
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
  const caps = capsForDay();
  let lastMarket: Market = "uk";

  console.log(
    JSON.stringify({
      msg: "crawler_start",
      globalPagesPerDay: GLOBAL_PAGES_PER_DAY,
      caps,
      crawlerEnabled: CRAWLER_ENABLED,
    }),
  );

  let browser: Browser | null = await chromium.launch({ headless: true });

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
    if (!CRAWLER_ENABLED) {
      await sleep(60_000);
      continue;
    }

    if (!browser) {
      browser = await chromium.launch({ headless: true });
    }

    const day = new Date().toISOString().slice(0, 10);
    await ensureBudgetRow(pool, day);
    const budget = await getBudget(pool, day);

    if (budget.pages_total >= GLOBAL_PAGES_PER_DAY) {
      console.log(JSON.stringify({ msg: "daily_budget_exhausted", day, budget }));
      await sleep(3600_000);
      continue;
    }

    const canUs = budget.us_pages < caps.us;
    const canUk = budget.uk_pages < caps.uk;
    let market: Market | null = null;
    if (canUs && canUk) {
      market = lastMarket === "us" ? "uk" : "us";
    } else if (canUs) market = "us";
    else if (canUk) market = "uk";
    else {
      await sleep(3600_000);
      continue;
    }
    lastMarket = market;

    const seedUrl = market === "us" ? US_SEED : UK_SEED;
    const pageNum = await getCrawlPage(pool, market, SEED_KEY);

    try {
      const { url: pageUrl, rows } = await fetchOnePage(browser, market, seedUrl, pageNum);
      const inserted = await upsertObservations(pool, market, rows, PARSE_VERSION);
      await incrementBudget(pool, day, market);

      if (rows.length === 0) {
        await setCrawlPage(pool, market, SEED_KEY, 0);
        await logEvent(pool, market, "empty_page_reset", { pageNum, pageUrl });
      } else {
        await setCrawlPage(pool, market, SEED_KEY, pageNum + 1);
      }

      console.log(
        JSON.stringify({
          msg: "page_ok",
          market,
          pageNum,
          parsed: rows.length,
          inserted,
          pageUrl,
        }),
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await logEvent(pool, market, "page_error", { pageNum, error: err });
      console.error(JSON.stringify({ msg: "page_error", market, error: err }));
      if (err.includes("browser") || err.includes("Target closed")) {
        await browser.close();
        browser = await chromium.launch({ headless: true });
      }
      await sleep(randBetween(60_000, 180_000));
    }

    await sleep(randBetween(MIN_DELAY_MS, MAX_DELAY_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
