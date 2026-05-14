import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { UnifiedSearchSnapshot } from "../types";
import { formatHistoryPrice, formatUsdDollars } from "../lib/cardAppUtils";
import { gradesFromTiersJson } from "../lib/parsePcTiers";

type UnifiedMarketHubProps = {
  vpsReady: boolean;
  pcApiApiBase: string;
  pcApiApiKey: string;
  onPersistPcApiSettings: () => void;
  onAddToBasket: (snap: UnifiedSearchSnapshot) => void;
};

export function UnifiedMarketHub({
  vpsReady,
  pcApiApiBase,
  pcApiApiKey,
  onPersistPcApiSettings,
  onAddToBasket,
}: UnifiedMarketHubProps) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<UnifiedSearchSnapshot | null>(null);

  const runSearch = useCallback(async () => {
    const query = q.trim();
    if (!query) {
      setErr("Enter a card name or keywords.");
      return;
    }
    if (!vpsReady) {
      setErr("Set your VPS API base URL and API key below (same stack as the eBay + PriceCharting crawlers).");
      return;
    }
    onPersistPcApiSettings();
    setLoading(true);
    setErr(null);
    setData(null);
    try {
      const baseArg = pcApiApiBase.trim() || undefined;
      const keyArg = pcApiApiKey.trim() || undefined;
      const out = await invoke<UnifiedSearchSnapshot>("pc_api_unified_search", {
        query,
        apiBase: baseArg ?? null,
        apiKey: keyArg ?? null,
      });
      setData(out);
      if (!out.product) {
        setErr("No PriceCharting row in your scrape DB for that query — widen keywords or run the pc-crawler.");
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [q, vpsReady, pcApiApiBase, pcApiApiKey, onPersistPcApiSettings]);

  const grades = data?.latestSnapshot?.tiers ? gradesFromTiersJson(data.latestSnapshot.tiers) : [];
  const sales = data?.ebayRecentSales ?? [];
  const product = data?.product;

  return (
    <section className="um-hub rounded-2xl border border-slate-700/80 bg-gradient-to-b from-slate-900 to-slate-950 p-6 text-slate-100 shadow-xl shadow-black/30 md:p-8">
      <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Market search</h2>
          <p className="mt-1 max-w-xl text-sm text-slate-400">
            One lookup against your VPS: best PriceCharting scrape match plus the latest recorded eBay sold rows from
            your crawler. Grade guide prices come from the crawler opening the matched card’s PriceCharting product page
            (stored in your DB), not from the search results page.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch();
          }}
          placeholder="e.g. Charizard Base Set holo, Pikachu promo…"
          className="min-h-[48px] flex-1 rounded-xl border border-slate-600 bg-slate-800/80 px-4 py-3 text-base text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          disabled={loading}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={loading || !q.trim()}
          className="min-h-[48px] shrink-0 rounded-xl bg-sky-600 px-8 py-3 text-base font-semibold text-white shadow-lg shadow-sky-900/40 transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {err && (
        <p className="mt-4 rounded-lg border border-amber-700/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
          {err}
        </p>
      )}

      {product && (
        <div className="mt-8 space-y-8">
          <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-start">
            <div className="flex w-full max-w-md shrink-0 justify-center lg:max-w-lg">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt=""
                  className="max-h-[min(72vh,520px)] w-full max-w-lg rounded-2xl border border-slate-600/80 bg-slate-800 object-contain shadow-2xl"
                />
              ) : (
                <div className="flex aspect-[3/4] w-full max-w-md items-center justify-center rounded-2xl border border-dashed border-slate-600 bg-slate-800/50 text-slate-500">
                  No image in scrape
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-3 text-center lg:text-left">
              <h3 className="text-2xl font-bold leading-tight text-white md:text-3xl">{product.title}</h3>
              <p className="text-slate-400">
                {[product.consoleOrCategory, product.cardNumber, product.publisher].filter(Boolean).join(" · ") ||
                  "—"}
              </p>
              {product.cardVariant && (
                <p className="text-sm text-slate-300">
                  <span className="font-medium text-slate-200">Variant:</span> {product.cardVariant}
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-3 pt-2 lg:justify-start">
                <button
                  type="button"
                  onClick={() => openUrl(product.productUrl)}
                  className="rounded-lg border border-slate-500 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                >
                  Open on PriceCharting
                </button>
                {data && (
                  <button
                    type="button"
                    onClick={() => onAddToBasket(data)}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                  >
                    Add to buy basket
                  </button>
                )}
              </div>
            </div>
          </div>

          <div>
            <h4 className="mb-4 text-lg font-semibold text-white">Guide prices by grade</h4>
            {grades.length === 0 ? (
              <p className="text-sm text-slate-500">
                No grade rows in the latest snapshot. The pc-crawler loads each product URL and parses the on-page
                grade table; if this stays empty after a crawl, the site may have changed layout or the run hit a
                block — check crawler logs for <code className="text-slate-400">pc_product_no_grade_rows</code>.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {grades.map((g, i) => (
                  <li
                    key={`${g.grade}-${i}`}
                    className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3"
                  >
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{g.grade}</div>
                    <div className="mt-1 text-lg font-semibold text-sky-300">{g.priceDisplay}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <h4 className="text-lg font-semibold text-white">Latest eBay sold (crawler DB)</h4>
              {data?.ebayAverageLast30 != null && (
                <p className="text-sm text-slate-400">
                  Avg of priced rows in window:{" "}
                  <strong className="text-slate-100">{formatUsdDollars(data.ebayAverageLast30)}</strong> (
                  {data.ebayAverageLast30Count} rows)
                </p>
              )}
            </div>
            {sales.length === 0 ? (
              <p className="text-sm text-slate-500">
                No listing observations yet for this title — your eBay crawler may not have captured matching sold
                listings.
              </p>
            ) : (
              <ul className="divide-y divide-slate-700/90 rounded-xl border border-slate-700 bg-slate-900/50">
                {sales.map((row) => (
                  <li key={`${row.ebayItemId}-${row.observedAt ?? ""}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => openUrl(row.pageUrl)}
                        className="text-left text-sm font-medium text-sky-400 hover:text-sky-300 hover:underline"
                      >
                        {row.title}
                      </button>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                        <span>{row.market}</span>
                        <span>{row.observedAt ?? "—"}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <span className="text-base font-semibold text-white">
                        {row.priceDisplay?.trim()
                          ? formatHistoryPrice(row.priceDisplay)
                          : row.priceValue != null
                            ? formatUsdDollars(row.priceValue)
                            : "—"}
                      </span>
                      <button
                        type="button"
                        onClick={() => openUrl(row.pageUrl)}
                        className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-600"
                      >
                        View listing
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
