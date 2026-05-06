import type { Browser } from "playwright";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import {
  addExtraInitScript,
  humanHoverSomeCards,
  humanPointerWander,
  humanReadingPause,
  humanScrollResults,
  humanSkimHome,
} from "./human.js";
import {
  createPool,
  ensureSchema,
  incrementBudget,
  getBudget,
  ensureBudgetRow,
  getCrawlPage,
  setCrawlPage,
  upsertObservations,
  logEvent,
  type Market,
} from "./db.js";

chromium.use(StealthPlugin());

const DATABASE_URL = process.env.DATABASE_URL;
const CRAWLER_ENABLED = (process.env.CRAWLER_ENABLED || "true").toLowerCase() === "true";
const GLOBAL_PAGES_PER_DAY = Math.max(1, Number(process.env.GLOBAL_PAGES_PER_DAY || 1000));
const US_SHARE = Math.min(1, Math.max(0, Number(process.env.US_SHARE ?? 0.5)));
const UK_SHARE = Math.min(1, Math.max(0, Number(process.env.UK_SHARE ?? 0.5)));
const MIN_DELAY_MS = Math.max(1000, Number(process.env.MIN_DELAY_MS || 8000));
const MAX_DELAY_MS = Math.max(MIN_DELAY_MS, Number(process.env.MAX_DELAY_MS || 45000));
/** After bot_wall, wait longer before retry (eBay rate-limits / challenges datacenter headless). */
const BOT_WALL_BACKOFF_MIN_MS = Math.max(
  60_000,
  Number(process.env.BOT_WALL_BACKOFF_MIN_MS || 180_000),
);
const BOT_WALL_BACKOFF_MAX_MS = Math.max(
  BOT_WALL_BACKOFF_MIN_MS,
  Number(process.env.BOT_WALL_BACKOFF_MAX_MS || 600_000),
);
const PAGE_ERR_BACKOFF_MIN_MS = 60_000;
const PAGE_ERR_BACKOFF_MAX_MS = 180_000;
const PARSE_VERSION = process.env.PARSE_VERSION || "1";
const US_SEED = process.env.US_SEED_URL || "https://www.ebay.com/sch/i.html?_sacat=31392&LH_Sold=1&LH_Complete=1&_ipg=60&rt=nc";
const UK_SEED = process.env.UK_SEED_URL || "https://www.ebay.co.uk/sch/i.html?_sacat=0&LH_Sold=1&LH_Complete=1&_ipg=60&rt=nc";

const SEED_KEY = "category_sold";

/** Optional pauses so navigation does not look instant (ms). */
const PRE_NAV_MIN_MS = Math.max(0, Number(process.env.PRE_NAV_MIN_MS ?? 1200));
const PRE_NAV_MAX_MS = Math.max(PRE_NAV_MIN_MS, Number(process.env.PRE_NAV_MAX_MS ?? 5000));

/** Load ebay.co.uk / ebay.com first so the search request has same-site cookies + referrer chain (toggle off if too slow). */
const WARMUP_EBAY_HOME = (process.env.WARMUP_EBAY_HOME || "true").toLowerCase() === "true";

/** Launched browser: bundled Chromium + stealth plugin + non-default window args. */
function launchChromium() {
  return chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--window-size=1280,800",
    ],
  });
}

function pickViewport(): { width: number; height: number } {
  const presets = [
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
  ];
  const p = presets[randBetween(0, presets.length - 1)]!;
  return { width: p.width + randBetween(-32, 32), height: p.height + randBetween(-32, 32) };
}

function chromeUserAgent(): string {
  const v = [131, 132, 133][randBetween(0, 2)]!;
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`;
}

function proxyForPlaywright():
  | { server: string; username?: string; password?: string }
  | undefined {
  const server = process.env.CRAWLER_PROXY_SERVER?.trim();
  if (!server) return undefined;
  const username = process.env.CRAWLER_PROXY_USER?.trim();
  const password = process.env.CRAWLER_PROXY_PASS?.trim();
  const p: { server: string; username?: string; password?: string } = { server };
  if (username) p.username = username;
  if (password) p.password = password;
  return p;
}

function newContextOptions(market: Market) {
  const viewport = pickViewport();
  const proxy = proxyForPlaywright();
  return {
    ...(proxy ? { proxy } : {}),
    locale: market === "uk" ? "en-GB" : "en-US",
    timezoneId: market === "uk" ? "Europe/London" : "America/Chicago",
    userAgent: chromeUserAgent(),
    viewport,
    screen: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    colorScheme: "light" as const,
    reducedMotion: "no-preference" as const,
    // Match a typical browser document request; do not set Sec-Fetch-* (Chromium sets them per request).
    extraHTTPHeaders: {
      "Accept-Language": market === "uk" ? "en-GB,en;q=0.9" : "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Upgrade-Insecure-Requests": "1",
      DNT: "1",
    },
  };
}

function ebayHomeOrigin(market: Market): string {
  return market === "uk" ? "https://www.ebay.co.uk/" : "https://www.ebay.com/";
}

/** Visit marketplace home before search (cookies + natural entry path). */
async function warmupEbayHome(page: import("playwright").Page, market: Market): Promise<void> {
  await page.goto(ebayHomeOrigin(market), {
    waitUntil: Math.random() < 0.3 ? "load" : "domcontentloaded",
    timeout: 90_000,
  });
  const homeHtml = await page.content();
  if (botWall(homeHtml)) {
    throw new Error("bot_wall");
  }
  await sleep(randBetween(1500, 4500));
  await humanSkimHome(page);
}

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
  const rawUs = Math.floor(GLOBAL_PAGES_PER_DAY * usRatio);
  const rawUk = Math.floor(GLOBAL_PAGES_PER_DAY * ukRatio);
  // Allow 0 pages when share is 0 (otherwise US_SHARE=0 still forced Math.max(1,0)=1 US hit/day → bot_wall).
  return {
    us: US_SHARE <= 0 ? 0 : Math.max(1, rawUs),
    uk: UK_SHARE <= 0 ? 0 : Math.max(1, rawUk),
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

type ParseDiag = {
  finalUrl: string;
  title: string;
  cards: number;
  sItems: number;
  itmLinks: number;
};

async function fetchOnePage(
  browser: Browser,
  market: Market,
  seedUrl: string,
  pageNum: number,
): Promise<{ url: string; rows: Row[]; diag: ParseDiag }> {
  const ctx = await browser.newContext(newContextOptions(market));
  const page = await ctx.newPage();
  await addExtraInitScript(page);
  const url = buildSearchUrl(seedUrl, pageNum);
  try {
    await sleep(randBetween(PRE_NAV_MIN_MS, PRE_NAV_MAX_MS));
    if (WARMUP_EBAY_HOME) {
      await warmupEbayHome(page, market);
    } else {
      await humanPointerWander(page);
      await sleep(randBetween(400, 1200));
    }
    await page.goto(url, {
      waitUntil: Math.random() < 0.35 ? "load" : "domcontentloaded",
      timeout: 120_000,
      referer: WARMUP_EBAY_HOME ? ebayHomeOrigin(market) : undefined,
    });
    await humanScrollResults(page);
    await page.waitForSelector("div.s-card[data-listingid]", { timeout: 50_000 }).catch(() => {});
    await humanHoverSomeCards(page);
    await humanReadingPause();
    await sleep(randBetween(300, 1200));
    const html = await page.content();
    if (botWall(html)) {
      throw new Error("bot_wall");
    }
    const { rows, diag } = await page.evaluate(
      (pageUrlArg) => {
        const out: Array<{
          itemId: string;
          title: string;
          priceText: string;
          caption: string;
          thumbUrl: string;
          itemUrl: string;
          pageUrl: string;
        }> = [];
        const seen = new Set<string>();
        const cards = Array.from(document.querySelectorAll("div.s-card[data-listingid], li.s-item"));
        const allItmLinks = Array.from(document.querySelectorAll('a[href*="/itm/"]')) as HTMLAnchorElement[];

        for (const card of cards) {
          const links = Array.from(card.querySelectorAll('a[href*="/itm/"]'));
          let href = "";
          let title = "";
          for (const a of links) {
            const el = a as HTMLAnchorElement;
            if (!href && el.href) href = el.href.split("?")[0];
            const text = (el.textContent || "").trim();
            if (text.length > 5 && !text.toLowerCase().startsWith("shop on ebay")) title = text;
          }
          if (!href) continue;

          const idFromHref = href.match(/\/itm\/(\d{8,})/)?.[1] || "";
          const idFromAttr = (card.getAttribute("data-listingid") || "").replace(/\D/g, "");
          const cleanId = idFromAttr || idFromHref;
          if (!cleanId || seen.has(cleanId)) continue;

          const img = card.querySelector("img");
          if (!title && img) title = (img.getAttribute("alt") || "").trim();
          const priceText =
            card.querySelector(".s-card__price, .s-item__price")?.textContent?.trim() || "";
          const caption =
            card.querySelector(".s-card__caption, .s-item__subtitle")?.textContent?.trim() || "";
          const thumbUrl = img?.getAttribute("src") || img?.getAttribute("data-src") || "";
          if (title.length < 5) continue;

          seen.add(cleanId);
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

        // Fallback: some eBay layouts don't use expected card wrappers.
        if (out.length === 0) {
          for (const a of allItmLinks) {
            const href = (a.href || "").split("?")[0];
            if (!href) continue;
            const cleanId = href.match(/\/itm\/(\d{8,})/)?.[1] || "";
            if (!cleanId || seen.has(cleanId)) continue;
            const root = a.closest("li, div, article") ?? document.body;
            const title =
              (a.textContent || "").trim() ||
              (root.querySelector("h1,h2,h3,[role='heading']")?.textContent || "").trim();
            if (!title || title.length < 5) continue;
            const img = root.querySelector("img");
            const priceText =
              root.querySelector(".s-card__price, .s-item__price, [class*='price']")?.textContent?.trim() ||
              "";
            const caption =
              root.querySelector(".s-card__caption, .s-item__subtitle, [class*='subtitle']")?.textContent?.trim() ||
              "";
            const thumbUrl = img?.getAttribute("src") || img?.getAttribute("data-src") || "";
            seen.add(cleanId);
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
        }

        return {
          rows: out,
          diag: {
            finalUrl: location.href,
            title: document.title || "",
            cards: document.querySelectorAll("div.s-card[data-listingid]").length,
            sItems: document.querySelectorAll("li.s-item").length,
            itmLinks: allItmLinks.length,
          },
        };
      },
      url,
    );
    return { url, rows, diag };
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
  const caps = capsForDay();
  let lastMarket: Market = "uk";

  console.log(
    JSON.stringify({
      msg: "crawler_start",
      globalPagesPerDay: GLOBAL_PAGES_PER_DAY,
      caps,
      crawlerEnabled: CRAWLER_ENABLED,
      warmupEbayHome: WARMUP_EBAY_HOME,
      proxyConfigured: Boolean(proxyForPlaywright()),
      humanBehavior: "stealth_plugin+home_warmup+scroll_hover_read",
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
    if (!CRAWLER_ENABLED) {
      await sleep(60_000);
      continue;
    }

    if (!browser) {
      browser = await launchChromium();
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
      const { url: pageUrl, rows, diag } = await fetchOnePage(browser, market, seedUrl, pageNum);
      const inserted = await upsertObservations(pool, market, rows, PARSE_VERSION);
      await incrementBudget(pool, day, market);

      if (rows.length === 0) {
        await setCrawlPage(pool, market, SEED_KEY, 0);
        await logEvent(pool, market, "empty_page_reset", { pageNum, pageUrl, diag });
        console.log(JSON.stringify({ msg: "parse_zero_debug", market, pageNum, pageUrl, diag }));
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
        browser = await launchChromium();
      }
      const isBotWall = err === "bot_wall";
      await sleep(
        randBetween(
          isBotWall ? BOT_WALL_BACKOFF_MIN_MS : PAGE_ERR_BACKOFF_MIN_MS,
          isBotWall ? BOT_WALL_BACKOFF_MAX_MS : PAGE_ERR_BACKOFF_MAX_MS,
        ),
      );
    }

    await sleep(randBetween(MIN_DELAY_MS, MAX_DELAY_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
