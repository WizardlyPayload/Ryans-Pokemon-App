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

function normalizeProductTitle(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Parse a release-style string to `YYYY-MM-DD` for Postgres, or null. */
function parsePgDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1]!;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

function detailValue(rows: Array<{ label: string; value: string }>, re: RegExp): string | null {
  const r = rows.find((x) => re.test(x.label.trim()));
  return r?.value?.trim() || null;
}

function extractCardFromTitle(title: string): string | null {
  const m = title.match(/#\s*([\w\-\/]+)/);
  return m ? `#${m[1]}` : null;
}

function nonEmpty(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
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

type ExtractedProduct = {
  id: string | null;
  title: string;
  console: string | null;
  image: string | null;
  tierText: string;
  grades: Array<{ grade: string; priceDisplay: string; priceUsd: number | null }>;
  detailRows: Array<{ label: string; value: string }>;
  releaseDateRaw: string | null;
  cardNumberRaw: string | null;
  publisherRaw: string | null;
};

async function extractProductPage(page: import("playwright").Page, productUrl: string): Promise<ExtractedProduct> {
  return page.evaluate((url) => {
    function norm(s: string | null | undefined): string {
      return (s || "").replace(/\s+/g, " ").trim();
    }
    function priceUsdFromText(t: string): number | null {
      const m = t.replace(/,/g, "").match(/\$\s*([\d]+(?:\.[\d]+)?)/);
      if (!m) return null;
      const n = parseFloat(m[1]!);
      return Number.isFinite(n) ? n : null;
    }
    function isGradeLabel(c: string): boolean {
      return (
        /Ungraded/i.test(c) ||
        /PSA\s*\d+/i.test(c) ||
        /BGS\s*\d+/i.test(c) ||
        /SGC\s*\d+/i.test(c) ||
        /CGC\s*[\d.]+/i.test(c) ||
        /Grade\s*\d+/i.test(c)
      );
    }

    const out = {
      id: null as string | null,
      title: "",
      console: null as string | null,
      image: null as string | null,
      tierText: "",
      grades: [] as Array<{ grade: string; priceDisplay: string; priceUsd: number | null }>,
      detailRows: [] as Array<{ label: string; value: string }>,
      releaseDateRaw: null as string | null,
      cardNumberRaw: null as string | null,
      publisherRaw: null as string | null,
    };

    out.image = document.querySelector('meta[property="og:image"]')?.getAttribute("content") || null;
    const h1 = document.querySelector("h1");
    if (h1) out.title = norm(h1.textContent);

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
    if (sub) out.console = norm(sub.textContent).slice(0, 500) || null;

    for (const dl of document.querySelectorAll("dl")) {
      for (const dt of dl.querySelectorAll("dt")) {
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName.toLowerCase() === "dd") {
          const label = norm(dt.textContent).replace(/:\s*$/, "");
          const value = norm(dd.textContent);
          if (label && value) out.detailRows.push({ label, value: value.slice(0, 500) });
        }
      }
    }

    for (const tr of document.querySelectorAll("table tr")) {
      const cells = tr.querySelectorAll("td,th");
      if (cells.length !== 2) continue;
      const a = norm(cells[0]!.textContent).replace(/:\s*$/, "");
      const b = norm(cells[1]!.textContent);
      if (a.length === 0 || b.length === 0 || a.length > 80) continue;
      if (/release|card number|publisher|genre|console|developer/i.test(a)) {
        out.detailRows.push({ label: a, value: b.slice(0, 500) });
      }
    }

    function rowLabelMatch(pat: RegExp): string | null {
      const row = out.detailRows.find((r) => pat.test(r.label));
      return row ? row.value : null;
    }

    out.releaseDateRaw = rowLabelMatch(/^release date$/i);
    out.cardNumberRaw = rowLabelMatch(/^card number$/i);
    out.publisherRaw = rowLabelMatch(/^publisher$/i);

    const bodyText = document.body?.innerText || "";
    if (!out.releaseDateRaw) {
      const br = bodyText.match(/Release Date\s*[:\n]\s*([^\n]+)/i);
      if (br) out.releaseDateRaw = norm(br[1]).slice(0, 120);
    }
    if (!out.cardNumberRaw) {
      const bc = bodyText.match(/Card Number\s*[:\n]\s*([^\n]+)/i);
      if (bc) out.cardNumberRaw = norm(bc[1]).slice(0, 120);
    }
    if (!out.publisherRaw) {
      const bp = bodyText.match(/Publisher\s*[:\n]\s*([^\n]+)/i);
      if (bp) out.publisherRaw = norm(bp[1]).slice(0, 200);
    }

    const gradeMap = new Map<string, { grade: string; priceDisplay: string; priceUsd: number | null }>();

    function addGrade(grade: string, priceDisplay: string) {
      const g = norm(grade);
      const pd = norm(priceDisplay);
      if (!g || g.length > 80 || !/\$/.test(pd)) return;
      const key = g.toLowerCase();
      if (!gradeMap.has(key)) {
        gradeMap.set(key, { grade: g, priceDisplay: pd, priceUsd: priceUsdFromText(pd) });
      }
    }

    for (const table of document.querySelectorAll("table")) {
      const txt = table.innerText || "";
      if (!/\$/.test(txt)) continue;
      if (!/Ungraded|PSA|Grade|BGS|CGC|SGC|\$\d/i.test(txt)) continue;

      const rows = [...table.querySelectorAll("tr")];
      const matrix = rows
        .slice(0, 30)
        .map((r) => [...r.querySelectorAll("th,td")].map((c) => norm(c.textContent)));

      if (matrix.length >= 2) {
        const header = matrix[0]!;
        if (header.some((h) => isGradeLabel(h))) {
          const priceRow = matrix.find((row) => row.some((c) => /\$\d/.test(c)));
          if (priceRow) {
            for (let i = 0; i < Math.min(header.length, priceRow.length); i++) {
              const h = header[i]!;
              const v = priceRow[i]!;
              if (isGradeLabel(h) && /\$/.test(v)) addGrade(h, v);
            }
          }
        }
      }

      for (const row of rows) {
        const cells = [...row.querySelectorAll("th,td")].map((c) => norm(c.textContent));
        if (cells.length < 2) continue;
        const priceCell = cells[cells.length - 1]!;
        const labelCell = cells[0]!;
        if (!/\$/.test(priceCell)) continue;
        if (!isGradeLabel(labelCell)) continue;
        addGrade(labelCell, priceCell);
      }
    }

    out.grades = [...gradeMap.values()];

    const tables = [...document.querySelectorAll("table")];
    for (const t of tables) {
      const ttxt = t.innerText || "";
      if (/\$/.test(ttxt) && /Ungraded|Grade\s*\d|PSA\s*\d/i.test(ttxt)) {
        out.tierText = ttxt.replace(/\s+/g, " ").trim().slice(0, 12000);
        break;
      }
    }

    void url;
    return out;
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
      const title = normalizeProductTitle(data.title) || slug;
      const releaseDate =
        parsePgDate(data.releaseDateRaw) ||
        parsePgDate(detailValue(data.detailRows, /release date/i));
      const cardNumber =
        nonEmpty(data.cardNumberRaw || detailValue(data.detailRows, /card number/i)) ||
        extractCardFromTitle(title);
      const publisher = nonEmpty(data.publisherRaw || detailValue(data.detailRows, /publisher/i));
      const tiers: Record<string, unknown> = {
        gridText: data.tierText,
        grades: data.grades,
      };
      const extras: Record<string, unknown> = {
        sourceUrl: href,
        detailRows: data.detailRows.slice(0, 40),
      };
      await upsertPcProduct(pool, {
        pcProductId: data.id,
        slug,
        productUrl: href,
        title,
        consoleOrCategory: data.console,
        imageUrl: data.image,
        cardNumber,
        releaseDate,
        publisher,
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
