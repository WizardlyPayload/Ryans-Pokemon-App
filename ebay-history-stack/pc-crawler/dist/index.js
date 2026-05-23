import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { buildSessionProfile } from "./fingerprint.js";
import { createPool, ensureSchema, upsertPcProduct } from "./db.js";
chromium.use(StealthPlugin());
const DATABASE_URL = process.env.DATABASE_URL;
const PC_CRAWLER_ENABLED = (process.env.PC_CRAWLER_ENABLED || "true").toLowerCase() === "true";
const PC_SEARCH_QUERY = (process.env.PC_SEARCH_QUERY || "pikachu").trim();
/** 0 = no cap (crawl all links discovered this run). */
const PC_PRODUCTS_PER_RUN = Math.max(0, Number(process.env.PC_PRODUCTS_PER_RUN || 0));
/** 0 = crawl pages until no links (bounded by PC_SEARCH_MAX_PAGES when >0). */
const PC_SEARCH_PAGES_PER_RUN = Math.max(0, Number(process.env.PC_SEARCH_PAGES_PER_RUN || 0));
/** 0 = no cap (paginate search until a page returns no links). >0 = safety cap on search pages. */
const PC_SEARCH_MAX_PAGES_RAW = Number(process.env.PC_SEARCH_MAX_PAGES ?? "0");
const PC_SEARCH_MAX_PAGES = !Number.isFinite(PC_SEARCH_MAX_PAGES_RAW) || PC_SEARCH_MAX_PAGES_RAW <= 0
    ? Number.MAX_SAFE_INTEGER
    : Math.max(1, Math.floor(PC_SEARCH_MAX_PAGES_RAW));
const PC_MIN_DELAY_MS = Math.max(500, Number(process.env.PC_MIN_DELAY_MS || 3000));
const PC_MAX_DELAY_MS = Math.max(PC_MIN_DELAY_MS, Number(process.env.PC_MAX_DELAY_MS || 14000));
const PC_LOOP_INTERVAL_MS = Math.max(60_000, Number(process.env.PC_LOOP_INTERVAL_MS || 3_600_000));
/** Parallel product tabs per batch (same browser context). Default 2; cap 6. */
const PC_FETCH_CONCURRENCY = Math.min(6, Math.max(1, Number(process.env.PC_FETCH_CONCURRENCY ?? "2")));
/** Parallel PriceCharting search-result pages per wave (same context). Default 3; cap 6. */
const PC_SEARCH_PAGE_CONCURRENCY = Math.min(6, Math.max(1, Number(process.env.PC_SEARCH_PAGE_CONCURRENCY ?? "3")));
const PARSE_VERSION = process.env.PARSE_VERSION || "1";
/** "prices" = price-guide search (card/product links). Set to "off" to omit. */
const PC_SEARCH_TYPE = (process.env.PC_SEARCH_TYPE ?? "prices").trim().toLowerCase();
const PC_BASE = "https://www.pricecharting.com";
/**
 * `search` = paginated `/search-products` (still filtered to Pokémon `/game/` URLs when PC_ONLY_POKEMON_GAME_URLS).
 * `pokemon_category` = open the TCG hub, collect `/console/pokemon-*` set pages, harvest `/game/` card links from each checklist.
 */
const PC_DISCOVERY_MODE = (process.env.PC_DISCOVERY_MODE ?? "pokemon_category").trim().toLowerCase();
const PC_CATEGORY_URL = (process.env.PC_CATEGORY_URL || `${PC_BASE}/category/pokemon-cards`).trim();
/** Max `/console/pokemon-*` set pages to open per batch for link harvest; 0 = all links found on the category page. */
const PC_CATEGORY_MAX_SET_PAGES = Math.max(0, Number(process.env.PC_CATEGORY_MAX_SET_PAGES ?? "0"));
/** When true, only keep product URLs under `/game/pokemon` (excludes Magic, Yu-Gi-Oh, video games, etc.). */
const PC_ONLY_POKEMON_GAME_URLS = (process.env.PC_ONLY_POKEMON_GAME_URLS ?? "true").toLowerCase() === "true";
function buildPcSearchUrl(query, page = 1) {
    const q = encodeURIComponent(query);
    const pageParam = page > 1 ? `&page=${page}` : "";
    if (!PC_SEARCH_TYPE || PC_SEARCH_TYPE === "off") {
        return `${PC_BASE}/search-products?q=${q}${pageParam}`;
    }
    return `${PC_BASE}/search-products?q=${q}&type=${encodeURIComponent(PC_SEARCH_TYPE)}${pageParam}`;
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/** Human-ish scroll: varied wheel deltas, pauses, occasional mouse jitter (not just scrollTo). */
async function humanScroll(page) {
    const height = await page.evaluate(() => document.body.scrollHeight);
    const viewportH = await page.evaluate(() => window.innerHeight);
    let current = 0;
    while (current < height + viewportH * 0.35) {
        if (Math.random() < 0.24) {
            await page.mouse.move(randBetween(60, 560), randBetween(140, 480), {
                steps: randBetween(4, 14),
            });
        }
        const step = randBetween(55, Math.min(520, Math.max(120, height - current + 60)));
        await page.mouse.wheel(0, step);
        current += step;
        await sleep(randBetween(85, 680));
    }
    await sleep(randBetween(120, 450));
}
function normalizePopulationSummary(raw) {
    if (!raw || !raw.trim())
        return null;
    const t = raw.trim();
    try {
        const j = JSON.parse(t);
        if (j && typeof j === "object" && !Array.isArray(j))
            return j;
    }
    catch {
        /* plain text */
    }
    return { text: t.slice(0, 8000) };
}
function randBetween(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
}
function normalizeProductTitle(s) {
    return s.replace(/\s+/g, " ").trim();
}
/** Parse a release-style string to `YYYY-MM-DD` for Postgres, or null. */
function parsePgDate(raw) {
    if (!raw)
        return null;
    const s = raw.trim();
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso)
        return iso[1];
    const t = Date.parse(s);
    if (!Number.isNaN(t))
        return new Date(t).toISOString().slice(0, 10);
    return null;
}
function detailValue(rows, re) {
    const r = rows.find((x) => re.test(x.label.trim()));
    return r?.value?.trim() || null;
}
function extractCardFromTitle(title) {
    const m = title.match(/#\s*([\w\-\/]+)/);
    return m ? `#${m[1]}` : null;
}
function nonEmpty(s) {
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
async function extractProductPage(page, productUrl) {
    return page.evaluate((url) => {
        function norm(s) {
            return (s || "").replace(/\s+/g, " ").trim();
        }
        function priceUsdFromText(t) {
            const m = t.replace(/,/g, "").match(/\$\s*([\d]+(?:\.[\d]+)?)/);
            if (!m)
                return null;
            const n = parseFloat(m[1]);
            return Number.isFinite(n) ? n : null;
        }
        function isGradeLabel(c) {
            return (/Ungraded/i.test(c) ||
                /PSA\s*\d+/i.test(c) ||
                /BGS\s*\d+/i.test(c) ||
                /SGC\s*\d+/i.test(c) ||
                /CGC\s*[\d.]+/i.test(c) ||
                /Grade\s*\d+/i.test(c));
        }
        /** Marketplace / sales-velocity tables — not the PSA price grid. */
        function isSalesVolumeNoiseTable(txt) {
            const t = txt.toLowerCase();
            if (/volume:\s*\d+\s*sales/.test(t))
                return true;
            if (/sales per (week|day|month|year)/.test(t))
                return true;
            if ((t.match(/\bvolume:/g) || []).length >= 2)
                return true;
            return false;
        }
        function looksLikeGradeColumnLabel(cell) {
            const s = norm(cell);
            if (!s || s.length > 80)
                return false;
            if (/^\$/.test(s))
                return false;
            if (/^[\d,$.\s]+$/.test(s))
                return false;
            return isGradeLabel(s);
        }
        const out = {
            id: null,
            title: "",
            console: null,
            image: null,
            tierText: "",
            grades: [],
            detailRows: [],
            releaseDateRaw: null,
            cardNumberRaw: null,
            publisherRaw: null,
            populationSummaryRaw: null,
            cardVariantRaw: null,
        };
        out.image = document.querySelector('meta[property="og:image"]')?.getAttribute("content") || null;
        const h1 = document.querySelector("h1");
        if (h1)
            out.title = norm(h1.textContent);
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
            out.console = norm(sub.textContent).slice(0, 500) || null;
        for (const dl of document.querySelectorAll("dl")) {
            for (const dt of dl.querySelectorAll("dt")) {
                const dd = dt.nextElementSibling;
                if (dd && dd.tagName.toLowerCase() === "dd") {
                    const label = norm(dt.textContent).replace(/:\s*$/, "");
                    const value = norm(dd.textContent);
                    if (label && value)
                        out.detailRows.push({ label, value: value.slice(0, 500) });
                }
            }
        }
        for (const tr of document.querySelectorAll("table tr")) {
            const cells = tr.querySelectorAll("td,th");
            if (cells.length !== 2)
                continue;
            const a = norm(cells[0].textContent).replace(/:\s*$/, "");
            const b = norm(cells[1].textContent);
            if (a.length === 0 || b.length === 0 || a.length > 80)
                continue;
            if (/release|card number|publisher|genre|console|developer|population|variant|printing|edition|holo|psa|bgs|cert/i.test(a)) {
                out.detailRows.push({ label: a, value: b.slice(0, 500) });
            }
        }
        function rowLabelMatch(pat) {
            const row = out.detailRows.find((r) => pat.test(r.label));
            return row ? row.value : null;
        }
        out.releaseDateRaw = rowLabelMatch(/^release date$/i);
        out.cardNumberRaw = rowLabelMatch(/^card number$/i);
        out.publisherRaw = rowLabelMatch(/^publisher$/i);
        const bodyText = document.body?.innerText || "";
        if (!out.releaseDateRaw) {
            const br = bodyText.match(/Release Date\s*[:\n]\s*([^\n]+)/i);
            if (br)
                out.releaseDateRaw = norm(br[1]).slice(0, 120);
        }
        if (!out.cardNumberRaw) {
            const bc = bodyText.match(/Card Number\s*[:\n]\s*([^\n]+)/i);
            if (bc)
                out.cardNumberRaw = norm(bc[1]).slice(0, 120);
        }
        if (!out.publisherRaw) {
            const bp = bodyText.match(/Publisher\s*[:\n]\s*([^\n]+)/i);
            if (bp)
                out.publisherRaw = norm(bp[1]).slice(0, 200);
        }
        let populationSummaryRaw = null;
        let cardVariantRaw = null;
        for (const row of out.detailRows) {
            const lab = row.label.trim();
            const low = lab.toLowerCase();
            if (/population|pop\s*report|psa\s*pop|bgs\s*pop|graded\s*population|how\s*many/i.test(low)) {
                populationSummaryRaw = row.value.trim().slice(0, 2000);
            }
            if (/variant|printing|edition|holo|reverse|1st|shadowless|promo|error|foil/i.test(low)) {
                const bit = `${lab}: ${row.value}`.trim().slice(0, 400);
                cardVariantRaw = cardVariantRaw ? `${cardVariantRaw} · ${bit}` : bit;
            }
        }
        out.populationSummaryRaw = populationSummaryRaw;
        out.cardVariantRaw = cardVariantRaw ? cardVariantRaw.slice(0, 2000) : null;
        const gradeMap = new Map();
        function addGrade(grade, priceDisplay) {
            const g = norm(grade);
            const pd = norm(priceDisplay);
            if (!g || g.length > 80 || !/\$/.test(pd))
                return;
            const key = g.toLowerCase();
            if (!gradeMap.has(key)) {
                gradeMap.set(key, { grade: g, priceDisplay: pd, priceUsd: priceUsdFromText(pd) });
            }
        }
        for (const table of document.querySelectorAll("table")) {
            const txt = table.innerText || "";
            if (!/\$/.test(txt))
                continue;
            if (!/Ungraded|PSA|Grade|BGS|CGC|SGC|\$\d/i.test(txt))
                continue;
            if (isSalesVolumeNoiseTable(txt))
                continue;
            const rows = [...table.querySelectorAll("tr")];
            const matrix = rows
                .slice(0, 30)
                .map((r) => [...r.querySelectorAll("th,td")].map((c) => norm(c.textContent)));
            if (matrix.length >= 2) {
                const header = matrix[0];
                if (header.some((h) => looksLikeGradeColumnLabel(h))) {
                    const priceRow = matrix.find((row) => row.some((c) => /\$\d/.test(c) && !/volume:/i.test(c)));
                    if (priceRow) {
                        for (let i = 0; i < Math.min(header.length, priceRow.length); i++) {
                            const h = header[i];
                            const v = priceRow[i];
                            if (looksLikeGradeColumnLabel(h) && /\$/.test(v) && !/volume:/i.test(v))
                                addGrade(h, v);
                        }
                    }
                }
            }
            for (const row of rows) {
                const cells = [...row.querySelectorAll("th,td")].map((c) => norm(c.textContent));
                if (cells.length < 2)
                    continue;
                const priceCell = cells[cells.length - 1];
                const labelCell = cells[0];
                if (!/\$/.test(priceCell))
                    continue;
                if (/volume:/i.test(priceCell))
                    continue;
                if (!looksLikeGradeColumnLabel(labelCell))
                    continue;
                addGrade(labelCell, priceCell);
            }
        }
        out.grades = [...gradeMap.values()];
        const tables = [...document.querySelectorAll("table")];
        for (const t of tables) {
            const ttxt = t.innerText || "";
            if (isSalesVolumeNoiseTable(ttxt))
                continue;
            if (/\$/.test(ttxt) && /Ungraded|Grade\s*\d|PSA\s*\d/i.test(ttxt)) {
                out.tierText = ttxt.replace(/\s+/g, " ").trim().slice(0, 12000);
                break;
            }
        }
        void url;
        return out;
    }, productUrl);
}
function usesPokemonCategoryDiscovery() {
    const m = PC_DISCOVERY_MODE;
    return m === "pokemon_category" || m === "category" || m === "pokemon";
}
function filterPokemonGameUrls(hrefs) {
    if (!PC_ONLY_POKEMON_GAME_URLS)
        return hrefs;
    return hrefs.filter((h) => {
        try {
            return new URL(h).pathname.toLowerCase().startsWith("/game/pokemon");
        }
        catch {
            return false;
        }
    });
}
async function extractPokemonConsoleLinksFromOpenPage(page) {
    const dom = await page.$$eval("a[href]", (anchors) => {
        const set = new Set();
        const origin = "https://www.pricecharting.com";
        for (const a of anchors) {
            const raw = a.getAttribute("href") || "";
            if (!raw.includes("/console/"))
                continue;
            try {
                const u = new URL(raw, origin);
                if (!u.hostname.endsWith("pricecharting.com"))
                    continue;
                if (!/^\/console\/pokemon/i.test(u.pathname))
                    continue;
                set.add(`${u.origin}${u.pathname}`.split("#")[0]);
            }
            catch {
                /* skip */
            }
        }
        return [...set];
    });
    if (dom.length > 0)
        return dom;
    const html = await page.content();
    const fromHtml = new Set();
    const absRe = /https?:\/\/(?:www\.)?pricecharting\.com\/console\/(pokemon[^"'>\s#?]+)/gi;
    let m;
    while ((m = absRe.exec(html)) !== null) {
        try {
            const u = new URL(`https://www.pricecharting.com/console/${m[1]}`);
            fromHtml.add(`${u.origin}${u.pathname}`);
        }
        catch {
            /* skip */
        }
    }
    const relRe = /(?:href|\shref)=["'](\/console\/pokemon[^"'#?]+)/gi;
    while ((m = relRe.exec(html)) !== null) {
        try {
            const u = new URL(m[1], PC_BASE);
            fromHtml.add(`${u.origin}${u.pathname}`.split("#")[0]);
        }
        catch {
            /* skip */
        }
    }
    return [...fromHtml];
}
async function extractPcGameLinksFromOpenPage(page, emptyLog) {
    try {
        await page.waitForSelector('a[href*="/game/"]', { timeout: 60_000 });
    }
    catch {
        /* hydrate / bot page — try scroll + HTML fallback below */
    }
    await humanScroll(page);
    const hrefsFromDom = await page.$$eval("a[href]", (anchors) => {
        const set = new Set();
        const origin = "https://www.pricecharting.com";
        for (const a of anchors) {
            const raw = a.getAttribute("href") || "";
            if (!raw.includes("/game/"))
                continue;
            try {
                const u = new URL(raw, origin);
                if (!u.hostname.endsWith("pricecharting.com"))
                    continue;
                if (!u.pathname.includes("/game/"))
                    continue;
                const canon = `${u.origin}${u.pathname}${u.search}`.split("#")[0];
                set.add(canon);
            }
            catch {
                /* skip */
            }
        }
        return [...set];
    });
    if (hrefsFromDom.length > 0) {
        return hrefsFromDom;
    }
    const html = await page.content();
    const fromHtml = new Set();
    const absRe = /https?:\/\/(?:www\.)?pricecharting\.com\/game\/[^"'>\s]+/gi;
    let m;
    while ((m = absRe.exec(html)) !== null) {
        fromHtml.add(m[0].replace(/&amp;/g, "&").split("#")[0]);
    }
    const relRe = /(?:href|\shref)=["'](\/game\/[^"'#]+)/gi;
    while ((m = relRe.exec(html)) !== null) {
        const path = m[1].replace(/&amp;/g, "&");
        try {
            const u = new URL(path, PC_BASE);
            fromHtml.add(`${u.origin}${u.pathname}${u.search}`.split("#")[0]);
        }
        catch {
            /* skip */
        }
    }
    if (fromHtml.size === 0 && emptyLog) {
        const probe = await page.evaluate(() => ({
            title: document.title,
            anchorCount: document.querySelectorAll("a").length,
            bodyTextLen: (document.body?.innerText || "").length,
        }));
        console.log(JSON.stringify({
            msg: emptyLog.msg,
            url: emptyLog.url,
            ...probe,
            hint: "No /game/ links in DOM or HTML. Often blocked/challenge page, or results still loading — check VPS IP / add wait.",
        }));
    }
    return [...fromHtml];
}
async function collectGameLinks(page, searchUrl) {
    await page.goto(searchUrl, { waitUntil: "load", timeout: 90_000 });
    await sleep(randBetween(800, 2000));
    return extractPcGameLinksFromOpenPage(page, { msg: "pc_search_no_links", url: searchUrl });
}
async function discoverPokemonCategoryLinks(ctx) {
    console.log(JSON.stringify({
        msg: "pc_category_discovery_start",
        categoryUrl: PC_CATEGORY_URL,
    }));
    const catPage = await ctx.newPage();
    let pagesVisited = 0;
    let consoleUrls = [];
    try {
        await catPage.goto(PC_CATEGORY_URL, { waitUntil: "load", timeout: 90_000 });
        pagesVisited += 1;
        await sleep(randBetween(800, 2000));
        try {
            await catPage.waitForSelector('a[href*="/console/pokemon"]', { timeout: 60_000 });
        }
        catch {
            /* */
        }
        await humanScroll(catPage);
        consoleUrls = await extractPokemonConsoleLinksFromOpenPage(catPage);
        if (consoleUrls.length === 0) {
            await sleep(randBetween(1200, 2200));
            await humanScroll(catPage);
            consoleUrls = await extractPokemonConsoleLinksFromOpenPage(catPage);
        }
    }
    finally {
        await catPage.close();
    }
    if (consoleUrls.length === 0) {
        console.log(JSON.stringify({
            msg: "pc_category_no_console_links",
            categoryUrl: PC_CATEGORY_URL,
            hint: "No /console/pokemon-* links on category page — layout change, block, or wrong PC_CATEGORY_URL.",
        }));
    }
    consoleUrls = [...new Set(consoleUrls)].sort((a, b) => a.localeCompare(b));
    const setCap = PC_CATEGORY_MAX_SET_PAGES;
    if (setCap > 0) {
        consoleUrls = consoleUrls.slice(0, setCap);
    }
    console.log(JSON.stringify({
        msg: "pc_category_sets_queued",
        uniqueSetPages: consoleUrls.length,
        categoryMaxSetPages: setCap,
    }));
    const seenGame = new Set();
    const conc = PC_SEARCH_PAGE_CONCURRENCY;
    for (let i = 0; i < consoleUrls.length; i += conc) {
        const wave = consoleUrls.slice(i, i + conc);
        const gameChunks = await Promise.all(wave.map(async (setUrl) => {
            const p = await ctx.newPage();
            try {
                await p.goto(setUrl, { waitUntil: "load", timeout: 90_000 });
                await sleep(randBetween(400, 1400));
                return await extractPcGameLinksFromOpenPage(p);
            }
            finally {
                await p.close();
            }
        }));
        pagesVisited += wave.length;
        for (const chunk of gameChunks) {
            for (const h of chunk) {
                seenGame.add(h);
            }
        }
        console.log(JSON.stringify({
            msg: "pc_category_set_wave_done",
            waveIndex: Math.floor(i / conc) + 1,
            waveSets: wave.length,
            cumulativeGameLinks: seenGame.size,
            setsTotal: consoleUrls.length,
        }));
    }
    if (consoleUrls.length > 0 && seenGame.size === 0) {
        console.log(JSON.stringify({
            msg: "pc_category_sets_yielded_no_game_links",
            setsOpened: consoleUrls.length,
            hint: "Set checklist pages opened but no /game/ links parsed — likely block or layout change.",
        }));
    }
    return { links: [...seenGame], pagesVisited, consoleSetUrls: consoleUrls.length };
}
/** Grade / price grid lives on each `/game/...` product page — not on search results. */
async function waitForProductGradeGrid(page, timeoutMs) {
    try {
        await page.waitForFunction(() => {
            for (const table of document.querySelectorAll("table")) {
                const t = table.innerText || "";
                if (!/\$/.test(t) || !/Ungraded|PSA|Grade|BGS|CGC|SGC/i.test(t))
                    continue;
                const low = t.toLowerCase();
                if (/volume:\s*\d+\s*sales/.test(low))
                    continue;
                if (/sales per (week|day|month|year)/.test(low))
                    continue;
                if ((low.match(/\bvolume:/g) || []).length >= 2)
                    continue;
                return true;
            }
            return false;
        }, { timeout: timeoutMs });
    }
    catch {
        /* timed out — still run extractor; may be blocked or layout changed */
    }
}
/**
 * Open the PriceCharting **product** URL (not search), let the grade table hydrate, then scrape.
 * Tiers JSON in DB always originates from this path — search pages only collect `/game/` links.
 */
async function loadProductPageForExtraction(page, href) {
    await page.goto(href, { waitUntil: "load", timeout: 90_000 });
    await sleep(randBetween(600, 1400));
    await waitForProductGradeGrid(page, 28_000);
    await humanScroll(page);
    await sleep(randBetween(500, 1100));
}
async function scrapeProductUrl(page, pool, href) {
    await sleep(randBetween(PC_MIN_DELAY_MS, PC_MAX_DELAY_MS));
    await loadProductPageForExtraction(page, href);
    let data = await extractProductPage(page, href);
    if (data.grades.length === 0) {
        await sleep(randBetween(1200, 2200));
        await humanScroll(page);
        await sleep(randBetween(400, 900));
        const retry = await extractProductPage(page, href);
        if (retry.grades.length > data.grades.length)
            data = retry;
    }
    if (!data.id) {
        console.log(JSON.stringify({ msg: "pc_skip_no_id", href }));
        return false;
    }
    const urlObj = new URL(href);
    const slug = urlObj.pathname.split("/").filter(Boolean).pop() || "";
    const title = normalizeProductTitle(data.title) || slug;
    const releaseDate = parsePgDate(data.releaseDateRaw) || parsePgDate(detailValue(data.detailRows, /release date/i));
    const cardNumber = nonEmpty(data.cardNumberRaw || detailValue(data.detailRows, /card number/i)) ||
        extractCardFromTitle(title);
    const publisher = nonEmpty(data.publisherRaw || detailValue(data.detailRows, /publisher/i));
    const populationSummary = normalizePopulationSummary(data.populationSummaryRaw);
    const cardVariant = nonEmpty(data.cardVariantRaw);
    const tiers = {
        gridText: data.tierText,
        grades: data.grades,
    };
    const extras = {
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
        cardVariant,
        populationSummary,
        tiers,
        extras,
        parseVersion: PARSE_VERSION,
    });
    if (data.grades.length === 0) {
        console.log(JSON.stringify({
            msg: "pc_product_no_grade_rows",
            href,
            pcProductId: data.id,
            hint: "Opened product page but extractor found no grade table — layout change, block, or lazy content.",
        }));
    }
    console.log(JSON.stringify({
        msg: "pc_stored",
        pcProductId: data.id,
        title: data.title,
        gradeRows: data.grades.length,
        source: "product_page",
    }));
    return true;
}
async function runBatch(browser, pool) {
    const profile = buildSessionProfile();
    const ctx = await browser.newContext({
        userAgent: profile.userAgent,
        viewport: profile.viewport,
        locale: profile.locale,
        timezoneId: profile.timezoneId,
        extraHTTPHeaders: profile.extraHTTPHeaders,
    });
    try {
        console.log(JSON.stringify({ msg: "pc_batch_begin", at: new Date().toISOString() }));
        let allLinks = [];
        let pagesVisited = 0;
        let discoveryLog;
        if (usesPokemonCategoryDiscovery()) {
            const cat = await discoverPokemonCategoryLinks(ctx);
            allLinks = cat.links;
            pagesVisited = cat.pagesVisited;
            discoveryLog = {
                msg: "pc_discovery_links",
                discoveryMode: PC_DISCOVERY_MODE,
                categoryUrl: PC_CATEGORY_URL,
                consoleSetUrlsHarvested: cat.consoleSetUrls,
                categoryMaxSetPages: PC_CATEGORY_MAX_SET_PAGES,
            };
        }
        else {
            if (PC_DISCOVERY_MODE !== "search" &&
                PC_DISCOVERY_MODE !== "off" &&
                PC_DISCOVERY_MODE !== "") {
                console.log(JSON.stringify({
                    msg: "pc_discovery_mode_fallback_search",
                    requested: PC_DISCOVERY_MODE,
                }));
            }
            const seen = new Set();
            let searchPage = 1;
            while (searchPage <= PC_SEARCH_MAX_PAGES) {
                console.log(JSON.stringify({
                    msg: "pc_search_wave_begin",
                    searchPageFrom: searchPage,
                    query: PC_SEARCH_QUERY,
                }));
                if (PC_SEARCH_PAGES_PER_RUN > 0 && searchPage > PC_SEARCH_PAGES_PER_RUN)
                    break;
                const waveEnd = Math.min(searchPage + PC_SEARCH_PAGE_CONCURRENCY - 1, PC_SEARCH_MAX_PAGES);
                const pageNums = [];
                for (let p = searchPage; p <= waveEnd; p++) {
                    if (PC_SEARCH_PAGES_PER_RUN > 0 && p > PC_SEARCH_PAGES_PER_RUN)
                        break;
                    pageNums.push(p);
                }
                if (pageNums.length === 0)
                    break;
                const waveResults = await Promise.all(pageNums.map(async (pg) => {
                    const p = await ctx.newPage();
                    try {
                        const searchUrl = buildPcSearchUrl(PC_SEARCH_QUERY, pg);
                        const links = await collectGameLinks(p, searchUrl);
                        return { pg, links };
                    }
                    finally {
                        await p.close();
                    }
                }));
                waveResults.sort((a, b) => a.pg - b.pg);
                let hitEmpty = false;
                for (const { pg, links } of waveResults) {
                    pagesVisited += 1;
                    for (const href of links) {
                        if (!seen.has(href)) {
                            seen.add(href);
                            allLinks.push(href);
                        }
                    }
                    if (links.length === 0) {
                        hitEmpty = true;
                        break;
                    }
                }
                if (hitEmpty)
                    break;
                searchPage = pageNums[pageNums.length - 1] + 1;
                console.log(JSON.stringify({
                    msg: "pc_search_wave_done",
                    searchPagesVisited: pagesVisited,
                    uniqueGameLinks: allLinks.length,
                    hitEmpty,
                }));
            }
            discoveryLog = {
                msg: "pc_discovery_links",
                discoveryMode: "search",
                query: PC_SEARCH_QUERY,
                searchUrl: buildPcSearchUrl(PC_SEARCH_QUERY, 1),
                searchType: PC_SEARCH_TYPE || null,
            };
        }
        const beforeFilter = allLinks.length;
        allLinks = filterPokemonGameUrls(allLinks);
        const effectiveCap = PC_PRODUCTS_PER_RUN > 0 ? PC_PRODUCTS_PER_RUN : allLinks.length;
        const slice = allLinks.slice(0, effectiveCap);
        const workers = Math.min(PC_FETCH_CONCURRENCY, Math.max(1, slice.length));
        if (slice.length === 0) {
            console.log(JSON.stringify({
                msg: "pc_batch_no_products_to_scrape",
                hint: "Discovery returned no /game/ links after Pokémon filter, or cap is zero.",
            }));
        }
        else {
            console.log(JSON.stringify({
                msg: "pc_product_scrape_begin",
                toScrape: slice.length,
                fetchConcurrency: workers,
            }));
        }
        console.log(JSON.stringify({
            ...discoveryLog,
            onlyPokemonGameUrls: PC_ONLY_POKEMON_GAME_URLS,
            countBeforePokemonFilter: beforeFilter,
            count: allLinks.length,
            pagesVisited,
            cappedTo: effectiveCap,
            fetchConcurrency: workers,
            sessionUserAgent: profile.userAgent.slice(0, 96),
        }));
        let stored = 0;
        if (workers <= 1) {
            const page = await ctx.newPage();
            try {
                for (const href of slice) {
                    if (await scrapeProductUrl(page, pool, href))
                        stored += 1;
                }
            }
            finally {
                await page.close();
            }
        }
        else {
            let cursor = 0;
            await Promise.all(Array.from({ length: workers }, async () => {
                const page = await ctx.newPage();
                try {
                    while (true) {
                        const i = cursor++;
                        if (i >= slice.length)
                            break;
                        if (await scrapeProductUrl(page, pool, slice[i]))
                            stored += 1;
                    }
                }
                finally {
                    await page.close();
                }
            }));
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
        discoveryMode: PC_DISCOVERY_MODE,
        categoryUrl: PC_CATEGORY_URL,
        categoryMaxSetPages: PC_CATEGORY_MAX_SET_PAGES,
        onlyPokemonGameUrls: PC_ONLY_POKEMON_GAME_URLS,
        searchQuery: PC_SEARCH_QUERY,
        searchType: PC_SEARCH_TYPE || null,
        productsPerRun: PC_PRODUCTS_PER_RUN,
        searchPagesPerRun: PC_SEARCH_PAGES_PER_RUN,
        searchMaxPages: PC_SEARCH_MAX_PAGES,
        fetchConcurrency: PC_FETCH_CONCURRENCY,
        searchPageConcurrency: PC_SEARCH_PAGE_CONCURRENCY,
        loopIntervalMs: PC_LOOP_INTERVAL_MS,
        parseVersion: PARSE_VERSION,
    }));
    let browser = await launchChromium();
    let pcDisabledWakeups = 0;
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
            pcDisabledWakeups += 1;
            if (pcDisabledWakeups === 1 || pcDisabledWakeups % 10 === 0) {
                console.log(JSON.stringify({
                    msg: "pc_crawler_disabled_idle",
                    wakeups: pcDisabledWakeups,
                    hint: "Set PC_CRAWLER_ENABLED=true to run PriceCharting batches.",
                }));
            }
            await sleep(60_000);
            continue;
        }
        pcDisabledWakeups = 0;
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
        console.log(JSON.stringify({
            msg: "pc_batch_sleep",
            sleepMs: PC_LOOP_INTERVAL_MS,
            nextBatchApprox: new Date(Date.now() + PC_LOOP_INTERVAL_MS).toISOString(),
        }));
        await sleep(PC_LOOP_INTERVAL_MS);
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
