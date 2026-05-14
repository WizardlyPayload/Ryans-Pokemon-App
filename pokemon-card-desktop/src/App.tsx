import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDebouncedValue } from "./lib/useDebouncedValue";
import { CardDetailPanel } from "./components/CardDetailPanel";
import { MainContent } from "./components/MainContent";
import { Sidebar } from "./components/Sidebar";
import type {
  BasketRow,
  CardLoadout,
  HistoryItemDetail,
  HistorySearchSnapshot,
  MarketCompareSnapshot,
  PcProductDetailResponse,
  PcSearchSnapshot,
  ProductSummary,
  UnifiedEbaySaleRow,
  UnifiedSearchSnapshot,
} from "./types";
import {
  BASKET_KEY,
  buildNarrowQuery,
  HISTORY_API_BASE_KEY,
  HISTORY_API_KEY_KEY,
  HISTORY_LAST_QUERY_KEY,
  loadBasket,
  mapVpsProductToCardLoadout,
  PC_API_BASE_KEY,
  PC_API_KEY_KEY,
  PC_LAST_QUERY_KEY,
  pickReferenceCents,
} from "./lib/cardAppUtils";

export default function App() {
  const [cardName, setCardName] = useState("");
  const [setName, setSetName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [variantNotes, setVariantNotes] = useState("");
  const [gradingCompany, setGradingCompany] = useState("__none__");
  const [grade, setGrade] = useState("Ungraded");
  const [language, setLanguage] = useState("Any");
  const [sealed, setSealed] = useState("Any");

  const composedQuery = useMemo(
    () =>
      buildNarrowQuery({
        cardName,
        setName,
        cardNumber,
        variantNotes,
        gradingCompany,
        grade,
        language,
        sealed,
      }),
    [cardName, setName, cardNumber, variantNotes, gradingCompany, grade, language, sealed],
  );

  const [searching, setSearching] = useState(false);
  const [loadingCard, setLoadingCard] = useState(false);
  const [hits, setHits] = useState<ProductSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lookupSource, setLookupSource] = useState<"vps" | "official" | null>(null);
  const [card, setCard] = useState<CardLoadout | null>(null);
  const [unifiedSales, setUnifiedSales] = useState<UnifiedEbaySaleRow[]>([]);
  const [unifiedAvg, setUnifiedAvg] = useState<number | null>(null);
  const [unifiedAvgCount, setUnifiedAvgCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);

  const [basket, setBasket] = useState<BasketRow[]>(() => loadBasket());

  useEffect(() => {
    try {
      localStorage.setItem(BASKET_KEY, JSON.stringify(basket));
    } catch {
      /* ignore */
    }
  }, [basket]);

  const [historyApiBase, setHistoryApiBase] = useState(() => {
    try {
      return localStorage.getItem(HISTORY_API_BASE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [historyApiKey, setHistoryApiKey] = useState(() => {
    try {
      return localStorage.getItem(HISTORY_API_KEY_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySnap, setHistorySnap] = useState<HistorySearchSnapshot | null>(null);
  const [historyDetail, setHistoryDetail] = useState<HistoryItemDetail | null>(null);
  const [historyDetailForId, setHistoryDetailForId] = useState<string | null>(null);
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState(() => {
    try {
      return localStorage.getItem(HISTORY_LAST_QUERY_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [historyMarketFilter, setHistoryMarketFilter] = useState<"all" | "uk" | "us">("all");

  const filteredHistoryRows = useMemo(() => {
    if (!historySnap?.results.length) return [];
    const f = historyMarketFilter;
    if (f === "all") return historySnap.results;
    return historySnap.results.filter((r) => r.market === f);
  }, [historySnap, historyMarketFilter]);

  const [pcApiApiBase, setpcApiApiBase] = useState(() => {
    try {
      return localStorage.getItem(PC_API_BASE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [pcApiApiKey, setpcApiApiKey] = useState(() => {
    try {
      return localStorage.getItem(PC_API_KEY_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [pcApiSearchQuery, setpcApiSearchQuery] = useState(() => {
    try {
      return localStorage.getItem(PC_LAST_QUERY_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [pcApiLoading, setpcApiLoading] = useState(false);
  const [pcApiCompareLoading, setpcApiCompareLoading] = useState(false);
  const [pcApiError, setpcApiError] = useState<string | null>(null);
  const [pcApiPcSnap, setpcApiPcSnap] = useState<PcSearchSnapshot | null>(null);
  const [pcApiCompareSnap, setpcApiCompareSnap] = useState<MarketCompareSnapshot | null>(null);
  const [pcApiEnvHint, setpcApiEnvHint] = useState<{ hasEnvBase: boolean; hasEnvKey: boolean }>({
    hasEnvBase: false,
    hasEnvKey: false,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const env = await invoke<{ apiBase?: string | null; hasApiKey: boolean }>("pc_api_pc_env");
        if (cancelled) return;
        setpcApiEnvHint({
          hasEnvBase: Boolean(env.apiBase),
          hasEnvKey: env.hasApiKey,
        });
        setpcApiApiBase((prev) => prev || (env.apiBase ?? ""));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistpcApiSettings = () => {
    try {
      localStorage.setItem(PC_API_BASE_KEY, pcApiApiBase);
      localStorage.setItem(PC_API_KEY_KEY, pcApiApiKey);
    } catch {
      /* ignore */
    }
  };

  const runpcApiPcSearch = useCallback(async () => {
    const q = pcApiSearchQuery.trim();
    if (!q) {
      setpcApiError("Enter a search query.");
      return;
    }
    persistpcApiSettings();
    try {
      localStorage.setItem(PC_LAST_QUERY_KEY, q);
    } catch {
      /* ignore */
    }
    setpcApiLoading(true);
    setpcApiError(null);
    setpcApiPcSnap(null);
    setpcApiCompareSnap(null);
    try {
      const baseArg = pcApiApiBase.trim() || undefined;
      const keyArg = pcApiApiKey.trim() || undefined;
      const out = await invoke<PcSearchSnapshot>("pc_api_pc_search", {
        query: q,
        apiBase: baseArg ?? null,
        apiKey: keyArg ?? null,
      });
      setpcApiPcSnap(out);
    } catch (e) {
      setpcApiError(String(e));
    } finally {
      setpcApiLoading(false);
    }
  }, [pcApiSearchQuery, pcApiApiBase, pcApiApiKey]);

  const runpcApiCompare = useCallback(async () => {
    const q = pcApiSearchQuery.trim();
    if (!q) {
      setpcApiError("Enter a search query.");
      return;
    }
    persistpcApiSettings();
    setpcApiCompareLoading(true);
    setpcApiError(null);
    setpcApiCompareSnap(null);
    try {
      const baseArg = pcApiApiBase.trim() || undefined;
      const keyArg = pcApiApiKey.trim() || undefined;
      const out = await invoke<MarketCompareSnapshot>("pc_api_market_compare", {
        query: q,
        apiBase: baseArg ?? null,
        apiKey: keyArg ?? null,
      });
      setpcApiCompareSnap(out);
      setpcApiPcSnap(out.pricecharting);
    } catch (e) {
      setpcApiError(String(e));
    } finally {
      setpcApiCompareLoading(false);
    }
  }, [pcApiSearchQuery, pcApiApiBase, pcApiApiKey]);

  const loadDetailsOfficial = useCallback(async (productId: string) => {
    setLoadingCard(true);
    setError(null);
    setCard(null);
    setUnifiedSales([]);
    setUnifiedAvg(null);
    setUnifiedAvgCount(0);
    try {
      const data = await invoke<CardLoadout>("load_card", { productId });
      setLookupSource("official");
      setCard(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingCard(false);
    }
  }, []);

  const loadDetailsVps = useCallback(
    async (pcProductId: string) => {
      setLoadingCard(true);
      setError(null);
      setCard(null);
      setUnifiedSales([]);
      setUnifiedAvg(null);
      setUnifiedAvgCount(0);
      persistpcApiSettings();
      try {
        const baseArg = pcApiApiBase.trim() || undefined;
        const keyArg = pcApiApiKey.trim() || undefined;
        const detail = await invoke<PcProductDetailResponse>("pc_api_pc_product", {
          productId: pcProductId,
          apiBase: baseArg ?? null,
          apiKey: keyArg ?? null,
        });
        setLookupSource("vps");
        setCard(mapVpsProductToCardLoadout(detail));
      } catch (e) {
        setError(String(e));
      } finally {
        setLoadingCard(false);
      }
    },
    [pcApiApiBase, pcApiApiKey],
  );

  const runPriceChartingSearch = useCallback(
    async (q: string) => {
      setSearching(true);
      setError(null);
      setCard(null);
      setSelectedId(null);
      setHits([]);
      setLookupSource(null);

      const canTryVps =
        (pcApiApiBase.trim().length > 0 || pcApiEnvHint.hasEnvBase) &&
        (pcApiApiKey.trim().length > 0 || pcApiEnvHint.hasEnvKey);

      if (canTryVps) {
        persistpcApiSettings();
        try {
          const baseArg = pcApiApiBase.trim() || undefined;
          const keyArg = pcApiApiKey.trim() || undefined;
          const snap = await invoke<PcSearchSnapshot>("pc_api_pc_search", {
            query: q,
            apiBase: baseArg ?? null,
            apiKey: keyArg ?? null,
          });
          if (snap.results.length > 0) {
            setLookupSource("vps");
            setHits(
              snap.results.map((r) => ({
                id: r.pcProductId,
                productName: r.title,
                consoleName: r.consoleOrCategory ?? "",
              })),
            );
            if (snap.results.length === 1) {
              const id = snap.results[0].pcProductId;
              setSelectedId(id);
              await loadDetailsVps(id);
            }
            setSearching(false);
            return;
          }
        } catch (e) {
          setError(`VPS scrape cache: ${String(e)}`);
          setSearching(false);
          return;
        }
      }

      try {
        const results = await invoke<ProductSummary[]>("pc_search_products", { query: q });
        setLookupSource("official");
        setHits(results);
        if (results.length === 1) {
          const id = results[0].id;
          setSelectedId(id);
          await loadDetailsOfficial(id);
        }
      } catch (e) {
        setError(String(e));
        setHits([]);
      } finally {
        setSearching(false);
      }
    },
    [
      pcApiApiBase,
      pcApiApiKey,
      pcApiEnvHint.hasEnvBase,
      pcApiEnvHint.hasEnvKey,
      loadDetailsVps,
      loadDetailsOfficial,
    ],
  );

  const getCardValue = useCallback(async (queryOverride?: string) => {
    const q = (queryOverride ?? composedQuery).trim();
    if (!q) {
      setError("Enter at least a card name (or set / number / notes) so we can narrow the search.");
      return;
    }
    const canTryVps =
      (pcApiApiBase.trim().length > 0 || pcApiEnvHint.hasEnvBase) &&
      (pcApiApiKey.trim().length > 0 || pcApiEnvHint.hasEnvKey);
    if (!canTryVps) {
      await runPriceChartingSearch(q);
      return;
    }

    setSearching(true);
    setLoadingCard(true);
    setError(null);
    setLookupSource(null);
    setCard(null);
    setHits([]);
    setSelectedId(null);
    setUnifiedSales([]);
    setUnifiedAvg(null);
    setUnifiedAvgCount(0);
    persistpcApiSettings();
    try {
      const baseArg = pcApiApiBase.trim() || undefined;
      const keyArg = pcApiApiKey.trim() || undefined;
      const out = await invoke<UnifiedSearchSnapshot>("pc_api_unified_search", {
        query: q,
        apiBase: baseArg ?? null,
        apiKey: keyArg ?? null,
      });
      setUnifiedSales(out.ebayRecentSales ?? []);
      setUnifiedAvg(out.ebayAverageLast30 ?? null);
      setUnifiedAvgCount(out.ebayAverageLast30Count ?? 0);
      if (!out.product) {
        setError("No PriceCharting product found in your VPS scrape cache for that query.");
        return;
      }
      setLookupSource("vps");
      setCard(
        mapVpsProductToCardLoadout({
          product: out.product,
          latestSnapshot: out.latestSnapshot ?? null,
        }),
      );
    } catch (e) {
      setError(`Unified VPS search failed: ${String(e)}`);
    } finally {
      setSearching(false);
      setLoadingCard(false);
    }
  }, [
    composedQuery,
    pcApiApiBase,
    pcApiApiKey,
    pcApiEnvHint.hasEnvBase,
    pcApiEnvHint.hasEnvKey,
    runPriceChartingSearch,
  ]);

  const persistHistorySettings = () => {
    try {
      localStorage.setItem(HISTORY_API_BASE_KEY, historyApiBase);
      localStorage.setItem(HISTORY_API_KEY_KEY, historyApiKey);
    } catch {
      /* ignore */
    }
  };

  const runHistorySearch = useCallback(async () => {
    const q = historySearchQuery.trim();
    if (!q) {
      setHistoryError("Type a search above, or click \"Use purchase sheet string\".");
      return;
    }
    if (!historyApiBase.trim()) {
      setHistoryError("Set the VPS API base URL (e.g. https://your-host:3001).");
      return;
    }
    persistHistorySettings();
    try {
      localStorage.setItem(HISTORY_LAST_QUERY_KEY, q);
    } catch {
      /* ignore */
    }
    setHistoryLoading(true);
    setHistoryError(null);
    setHistorySnap(null);
    setHistoryDetail(null);
    setHistoryDetailForId(null);
    try {
      const out = await invoke<HistorySearchSnapshot>("history_search_vps", {
        query: q,
        apiBase: historyApiBase.trim(),
        apiKey: historyApiKey,
      });
      setHistorySnap(out);
    } catch (e) {
      setHistoryError(String(e));
    } finally {
      setHistoryLoading(false);
    }
  }, [historySearchQuery, historyApiBase, historyApiKey]);

  const loadItemHistory = useCallback(
    async (ebayItemId: string) => {
      if (!historyApiBase.trim()) {
        setHistoryError("Set the VPS API base URL.");
        return;
      }
      persistHistorySettings();
      setHistoryDetailLoading(true);
      setHistoryError(null);
      setHistoryDetailForId(ebayItemId);
      try {
        const out = await invoke<HistoryItemDetail>("history_item_vps", {
          ebayItemId,
          apiBase: historyApiBase.trim(),
          apiKey: historyApiKey,
        });
        setHistoryDetail(out);
      } catch (e) {
        setHistoryError(String(e));
        setHistoryDetail(null);
      } finally {
        setHistoryDetailLoading(false);
      }
    },
    [historyApiBase, historyApiKey],
  );

  const addToBasket = useCallback(() => {
    if (!card) return;
    const label = [
      card.product.productName,
      setName.trim() && ` · ${setName.trim()}`,
      cardNumber.trim() && `#${cardNumber.trim()}`,
      variantNotes.trim() && `(${variantNotes.trim()})`,
    ]
      .filter(Boolean)
      .join(" ");
    const ref = pickReferenceCents(card);
    const row: BasketRow = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      addedAt: new Date().toISOString(),
      cardLabel: label || card.product.productName,
      paidCents: null,
      currentValueCents: ref,
      method: "",
    };
    setBasket((prev) => [row, ...prev]);
  }, [card, setName, cardNumber, variantNotes]);

  const updateBasketPaid = useCallback((id: string, paidCents: number | null) => {
    setBasket((prev) => prev.map((r) => (r.id === id ? { ...r, paidCents } : r)));
  }, []);

  const updateBasketMethod = useCallback((id: string, method: BasketRow["method"]) => {
    setBasket((prev) => prev.map((r) => (r.id === id ? { ...r, method } : r)));
  }, []);

  const removeBasketRow = useCallback((id: string) => {
    setBasket((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const basketSummaryLabel = useMemo(() => {
    if (!card) return composedQuery || "—";
    return card.product.productName;
  }, [card, composedQuery]);

  const vpsReady = useMemo(
    () =>
      (pcApiApiBase.trim().length > 0 || pcApiEnvHint.hasEnvBase) &&
      (pcApiApiKey.trim().length > 0 || pcApiEnvHint.hasEnvKey),
    [pcApiApiBase, pcApiApiKey, pcApiEnvHint.hasEnvBase, pcApiEnvHint.hasEnvKey],
  );

  const addUnifiedSnapshotToBasket = useCallback((snap: UnifiedSearchSnapshot) => {
    if (!snap.product) return;
    const tempCard = mapVpsProductToCardLoadout({
      product: snap.product,
      latestSnapshot: snap.latestSnapshot ?? null,
    });
    const ref = pickReferenceCents(tempCard);
    const row: BasketRow = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      addedAt: new Date().toISOString(),
      cardLabel: snap.product.title,
      paidCents: null,
      currentValueCents: ref,
      method: "",
    };
    setBasket((prev) => [row, ...prev]);
  }, []);

  const debouncedQuery = useDebouncedValue(composedQuery, 750);
  const [liveSearch, setLiveSearch] = useState(false);

  /** Reactive lookup: same pipelines as "Get card value", keyed off debounced query (not selectedId). */
  useEffect(() => {
    if (!liveSearch) return;
    const q = debouncedQuery.trim();
    if (q.length < 4) return;
    void getCardValue(q);
  }, [debouncedQuery, liveSearch, getCardValue]);

  /** Detail column open when a card is visible or loading (unified search sets card without selectedId). */
  const detailPanelOpen = Boolean(card) || loadingCard;

  return (
    <div className="app theme-light app-root min-h-screen">
      <header className="header header-shell">
        <div>
          <h1 className="text-slate-900">Pokémon card desktop</h1>
          <p className="tagline">
            Market search pulls PriceCharting scrape + eBay crawler data from your VPS. Advanced tools below for narrow
            purchase fields and raw API panels.
          </p>
        </div>
        <button type="button" className="linkish" onClick={() => setShowAbout(true)}>
          Data sources
        </button>
      </header>

      <div className={`app-shell-grid ${detailPanelOpen ? "app-shell-grid--detail-open" : ""}`}>
        <Sidebar
          basket={basket}
          onUpdatePaid={updateBasketPaid}
          onUpdateMethod={updateBasketMethod}
          onRemoveRow={removeBasketRow}
        />

        <MainContent
          composedQuery={composedQuery}
          cardName={cardName}
          setCardName={setCardName}
          setName={setName}
          setSetName={setSetName}
          cardNumber={cardNumber}
          setCardNumber={setCardNumber}
          variantNotes={variantNotes}
          setVariantNotes={setVariantNotes}
          gradingCompany={gradingCompany}
          setGradingCompany={setGradingCompany}
          grade={grade}
          setGrade={setGrade}
          language={language}
          setLanguage={setLanguage}
          sealed={sealed}
          setSealed={setSealed}
          onGetCardValue={() => void getCardValue()}
          liveSearch={liveSearch}
          onLiveSearchChange={setLiveSearch}
          searching={searching}
          loadingCard={loadingCard}
          historyApiBase={historyApiBase}
          setHistoryApiBase={setHistoryApiBase}
          historyApiKey={historyApiKey}
          setHistoryApiKey={setHistoryApiKey}
          onPersistHistorySettings={persistHistorySettings}
          historySearchQuery={historySearchQuery}
          setHistorySearchQuery={setHistorySearchQuery}
          onRunHistorySearch={runHistorySearch}
          historyLoading={historyLoading}
          historyDetailLoading={historyDetailLoading}
          historyError={historyError}
          historySnap={historySnap}
          filteredHistoryRows={filteredHistoryRows}
          historyMarketFilter={historyMarketFilter}
          setHistoryMarketFilter={setHistoryMarketFilter}
          onLoadItemHistory={loadItemHistory}
          historyDetail={historyDetail}
          historyDetailForId={historyDetailForId}
          pcApiEnvHint={pcApiEnvHint}
          pcApiApiBase={pcApiApiBase}
          setpcApiApiBase={setpcApiApiBase}
          pcApiApiKey={pcApiApiKey}
          setpcApiApiKey={setpcApiApiKey}
          onPersistPcApiSettings={persistpcApiSettings}
          pcApiSearchQuery={pcApiSearchQuery}
          setpcApiSearchQuery={setpcApiSearchQuery}
          onRunPcApiSearch={runpcApiPcSearch}
          onRunPcApiCompare={runpcApiCompare}
          pcApiLoading={pcApiLoading}
          pcApiCompareLoading={pcApiCompareLoading}
          pcApiError={pcApiError}
          pcApiPcSnap={pcApiPcSnap}
          pcApiCompareSnap={pcApiCompareSnap}
          hits={hits}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          lookupSource={lookupSource}
          onLoadDetailsVps={loadDetailsVps}
          onLoadDetailsOfficial={loadDetailsOfficial}
          error={error}
          vpsReady={vpsReady}
          onAddUnifiedToBasket={addUnifiedSnapshotToBasket}
        />

        {detailPanelOpen && (
          <CardDetailPanel
            loadingCard={loadingCard}
            card={card}
            lookupSource={lookupSource}
            unifiedSales={unifiedSales}
            unifiedAvg={unifiedAvg}
            unifiedAvgCount={unifiedAvgCount}
            basketSummaryLabel={basketSummaryLabel}
            onAddToBasket={addToBasket}
          />
        )}
      </div>

      {showAbout && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowAbout(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Data sources & limitations</h3>
            <ul className="about-list">
              <li>
                <strong>PriceCharting</strong> — either your <strong>VPS scrape cache</strong> (preferred when{" "}
                <code>PC_API_*</code> is set) or the official API token for live product + marketplace sold rows.
              </li>
              <li>
                <strong>eBay</strong> uses the Browse API for <strong>active</strong> listings only.
              </li>
              <li>
                <strong>Recorded eBay sales</strong> searches your VPS crawler database (completed listings your stack
                stored).
              </li>
              <li>
                Store API tokens in <code>.env</code> at the project root (see <code>.env.example</code>).
              </li>
            </ul>
            <button type="button" className="primary" onClick={() => setShowAbout(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
