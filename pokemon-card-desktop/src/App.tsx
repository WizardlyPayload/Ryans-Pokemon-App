import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";

const HISTORY_API_BASE_KEY = "pokemon-desktop-history-api-base";
const HISTORY_API_KEY_KEY = "pokemon-desktop-history-api-key";
const BASKET_KEY = "pokemon-buy-basket";

type ProductSummary = {
  id: string;
  productName: string;
  consoleName: string;
};

type PcSoldOffer = {
  offerId: string;
  priceCents: number;
  saleTime?: string;
  conditionString?: string;
  includeString?: string;
  offerUrl: string;
};

type TierView = {
  tierKey: string;
  label: string;
  priceField: string;
  priceCents: number | null;
  conditionId: number | null;
  sold: PcSoldOffer[];
  soldSectionNote?: string;
};

type EbayListing = {
  title: string;
  priceDisplay: string;
  condition: string;
  imageUrl?: string;
  itemWebUrl: string;
};

type CardLoadout = {
  product: {
    id: string;
    productName: string;
    consoleName: string;
    genre?: string;
    imageUrl?: string;
    pricechartingSearchUrl: string;
  };
  tiers: TierView[];
  ebayActive: EbayListing[];
  warnings: string[];
};

type HistorySearchRow = {
  ebayItemId: string;
  title: string;
  priceDisplay?: string | null;
  market: string;
  observedAt?: string | null;
  pageUrl: string;
};

type HistorySearchSnapshot = {
  query: string;
  results: HistorySearchRow[];
};

type HistoryObservationRow = {
  ebayItemId: string;
  title: string;
  priceDisplay?: string | null;
  detail?: string | null;
  market: string;
  observedAt?: string | null;
  thumbnailUrl?: string | null;
  pageUrl: string;
};

type HistoryItemDetail = {
  ebayItemId: string;
  history: HistoryObservationRow[];
};

type BasketRow = {
  id: string;
  addedAt: string;
  cardLabel: string;
  paidCents: number | null;
  currentValueCents: number | null;
  method: "cash" | "trade" | "";
};

function formatUsd(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function parseMoneyInput(raw: string): number | null {
  const t = raw.trim().replace(/[$,]/g, "");
  if (!t) return null;
  const n = Number.parseFloat(t);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

function buildNarrowQuery(p: {
  cardName: string;
  setName: string;
  cardNumber: string;
  variantNotes: string;
  gradingCompany: string;
  grade: string;
  language: string;
  sealed: string;
}): string {
  const parts: string[] = [];
  if (p.cardName.trim()) parts.push(p.cardName.trim());
  if (p.setName.trim()) parts.push(p.setName.trim());
  if (p.cardNumber.trim()) parts.push(p.cardNumber.trim());
  if (p.variantNotes.trim()) parts.push(p.variantNotes.trim());
  if (p.gradingCompany && p.gradingCompany !== "__none__") parts.push(p.gradingCompany);
  if (p.grade && p.grade !== "Ungraded") parts.push(p.grade);
  if (p.language && p.language !== "Any") parts.push(p.language);
  if (p.sealed === "Sealed only") parts.push("sealed");
  if (p.sealed === "Not sealed") parts.push("opened");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function pickReferenceCents(card: CardLoadout): number | null {
  const loose = card.tiers.find((t) => t.tierKey === "loose");
  if (loose?.priceCents != null) return loose.priceCents;
  for (const t of card.tiers) {
    if (t.priceCents != null) return t.priceCents;
  }
  return null;
}

function loadBasket(): BasketRow[] {
  try {
    const raw = localStorage.getItem(BASKET_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is BasketRow =>
        typeof r === "object" &&
        r !== null &&
        "id" in r &&
        "cardLabel" in r &&
        typeof (r as BasketRow).id === "string",
    );
  } catch {
    return [];
  }
}

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
  const [card, setCard] = useState<CardLoadout | null>(null);
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

  const loadDetails = useCallback(async (productId: string) => {
    setLoadingCard(true);
    setError(null);
    setCard(null);
    try {
      const data = await invoke<CardLoadout>("load_card", { productId });
      setCard(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingCard(false);
    }
  }, []);

  const runPriceChartingSearch = useCallback(async (q: string) => {
    setSearching(true);
    setError(null);
    setCard(null);
    setSelectedId(null);
    setHits([]);
    try {
      const results = await invoke<ProductSummary[]>("pc_search_products", { query: q });
      setHits(results);
      if (results.length === 1) {
        const id = results[0].id;
        setSelectedId(id);
        await loadDetails(id);
      }
    } catch (e) {
      setError(String(e));
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, [loadDetails]);

  const getCardValue = useCallback(async () => {
    const q = composedQuery;
    if (!q) {
      setError("Enter at least a card name (or set / number / notes) so we can narrow the search.");
      return;
    }
    await runPriceChartingSearch(q);
  }, [composedQuery, runPriceChartingSearch]);

  const persistHistorySettings = () => {
    try {
      localStorage.setItem(HISTORY_API_BASE_KEY, historyApiBase);
      localStorage.setItem(HISTORY_API_KEY_KEY, historyApiKey);
    } catch {
      /* ignore */
    }
  };

  const runHistorySearch = useCallback(async () => {
    const q = composedQuery;
    if (!q) {
      setHistoryError("Use the purchase sheet above to build a search (card name, set, etc.).");
      return;
    }
    if (!historyApiBase.trim()) {
      setHistoryError("Set the VPS API base URL (e.g. https://your-host:3001).");
      return;
    }
    persistHistorySettings();
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
  }, [composedQuery, historyApiBase, historyApiKey]);

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
      setName.trim() && `· ${setName.trim()}`,
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
    setBasket((prev) =>
      prev.map((r) => (r.id === id ? { ...r, paidCents } : r)),
    );
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

  return (
    <div className="app theme-light">
      <header className="header">
        <div>
          <h1>Pokémon purchase sheet</h1>
          <p className="tagline">
            Enter detailed card info, fetch market data, then use 70% cash / 80% trade offers as your baseline.
          </p>
        </div>
        <button type="button" className="linkish" onClick={() => setShowAbout(true)}>
          Data sources
        </button>
      </header>

      <section className="purchase-sheet" aria-label="Card lookup">
        <div className="form-grid">
          <label className="field">
            <span className="field-label">Card name</span>
            <input
              className="field-input"
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
              placeholder="e.g. Pikachu"
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span className="field-label">Set name</span>
            <input
              className="field-input"
              value={setName}
              onChange={(e) => setSetName(e.target.value)}
              placeholder="e.g. Base Set"
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span className="field-label">Card number</span>
            <input
              className="field-input"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder="e.g. 58/102"
              autoComplete="off"
            />
          </label>
          <label className="field field-span-2">
            <span className="field-label">Variant / notes</span>
            <input
              className="field-input"
              value={variantNotes}
              onChange={(e) => setVariantNotes(e.target.value)}
              placeholder="e.g. 1st Edition Shadowless Red Cheeks"
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span className="field-label">Grading company</span>
            <select
              className="field-input"
              value={gradingCompany}
              onChange={(e) => setGradingCompany(e.target.value)}
            >
              <option value="__none__">Select company</option>
              <option value="PSA">PSA</option>
              <option value="BGS">BGS</option>
              <option value="CGC">CGC</option>
              <option value="SGC">SGC</option>
              <option value="TAG">TAG</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Grade</span>
            <select className="field-input" value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="Ungraded">Ungraded</option>
              <option value="10">Gem Mint 10</option>
              <option value="9.5">9.5</option>
              <option value="9">9</option>
              <option value="8">8</option>
              <option value="7">7</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Language</span>
            <select className="field-input" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="Any">Any</option>
              <option value="English">English</option>
              <option value="Japanese">Japanese</option>
              <option value="Korean">Korean</option>
              <option value="Chinese">Chinese</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Sealed</span>
            <select className="field-input" value={sealed} onChange={(e) => setSealed(e.target.value)}>
              <option value="Any">Any</option>
              <option value="Sealed only">Sealed only</option>
              <option value="Not sealed">Not sealed</option>
            </select>
          </label>
        </div>

        <p className="query-preview" aria-live="polite">
          <strong>Search string:</strong> {composedQuery || "(add fields above)"}
        </p>

        <button
          type="button"
          className="btn-get-value"
          onClick={() => void getCardValue()}
          disabled={searching || loadingCard || !composedQuery}
        >
          {searching ? "Searching PriceCharting…" : "Get card value"}
        </button>
      </section>

      {hits.length > 1 && (
        <section className="panel hits-panel">
          <h2 className="panel-title">Choose product match</h2>
          <p className="muted small">Multiple PriceCharting products matched your narrowed search. Pick one, then load.</p>
          <ul className="hits-list">
            {hits.map((h) => (
              <li key={h.id}>
                <label className="hit-row">
                  <input
                    type="radio"
                    name="product"
                    checked={selectedId === h.id}
                    onChange={() => setSelectedId(h.id)}
                  />
                  <span>
                    <strong>{h.productName}</strong>
                    <span className="muted"> · {h.consoleName}</span>
                    <span className="muted"> · id {h.id}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="primary"
            onClick={() => selectedId && void loadDetails(selectedId)}
            disabled={!selectedId || loadingCard}
          >
            {loadingCard ? "Loading…" : "Load selected card data"}
          </button>
        </section>
      )}

      {error && <div className="error-banner">{error}</div>}

      {card && (
        <main className="main">
          <section className="panel card-actions-bar">
            <div>
              <strong>Loaded:</strong> {basketSummaryLabel}
              {pickReferenceCents(card) != null && (
                <span className="ref-price"> · Ref. {formatUsd(pickReferenceCents(card))}</span>
              )}
            </div>
            <button type="button" className="primary" onClick={addToBasket}>
              Add to buy basket
            </button>
          </section>

          <section className="card-hero">
            <div className="hero-image-wrap">
              {card.product.imageUrl ? (
                <img src={card.product.imageUrl} alt="" className="hero-image" />
              ) : (
                <div className="hero-placeholder">No image in PriceCharting product payload</div>
              )}
            </div>
            <div className="hero-meta">
              <h2>{card.product.productName}</h2>
              <p className="muted">{card.product.consoleName}</p>
              {card.product.genre && <p className="muted">Genre: {card.product.genre}</p>}
              <button
                type="button"
                className="linkish"
                onClick={() => openUrl(card.product.pricechartingSearchUrl)}
              >
                Open PriceCharting search
              </button>
            </div>
          </section>

          {card.warnings.length > 0 && (
            <ul className="warnings">
              {card.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          <section className="tiers-section">
            <h3>Condition tiers (PriceCharting)</h3>
            <p className="tier-intro muted">
              Reference prices and recent sold rows from the PriceCharting marketplace per condition bucket (when
              available).
            </p>
            <div className="tier-list">
              {card.tiers.map((tier) => (
                <details key={tier.tierKey} className="tier" open={tier.tierKey === "loose"}>
                  <summary>
                    <span className="tier-title">{tier.label}</span>
                    <span className="tier-price">{formatUsd(tier.priceCents ?? null)}</span>
                  </summary>
                  <div className="tier-body">
                    <p className="muted small">
                      API field: <code>{tier.priceField}</code>
                      {tier.conditionId != null && (
                        <>
                          {" "}
                          · Marketplace condition-id <code>{tier.conditionId}</code>
                        </>
                      )}
                    </p>
                    {tier.soldSectionNote && <p className="note">{tier.soldSectionNote}</p>}
                    {tier.sold.length === 0 && !tier.soldSectionNote && (
                      <p className="muted small">No sold rows returned for this bucket.</p>
                    )}
                    {tier.sold.length > 0 && (
                      <table className="sold-table">
                        <thead>
                          <tr>
                            <th>Sale date</th>
                            <th>Price</th>
                            <th>Condition</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {tier.sold.map((o) => (
                            <tr key={o.offerId}>
                              <td>{o.saleTime ?? "—"}</td>
                              <td>{formatUsd(o.priceCents)}</td>
                              <td>
                                {[o.includeString, o.conditionString].filter(Boolean).join(" · ") || "—"}
                              </td>
                              <td>
                                {o.offerUrl && (
                                  <button
                                    type="button"
                                    className="linkish"
                                    onClick={() => openUrl(o.offerUrl)}
                                  >
                                    View
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section className="ebay-section">
            <h3>Active listings (eBay)</h3>
            <p className="ebay-disclaimer">
              Currently active listings on eBay (US, Pokémon TCG singles) — not completed sales.
            </p>
            {card.ebayActive.length === 0 ? (
              <p className="muted">No listings returned (check credentials or try another card).</p>
            ) : (
              <ul className="ebay-grid">
                {card.ebayActive.map((it, i) => (
                  <li key={i} className="ebay-card">
                    <div className="ebay-thumb-wrap">
                      {it.imageUrl ? (
                        <img src={it.imageUrl} alt="" className="ebay-thumb" />
                      ) : (
                        <div className="ebay-thumb-placeholder" />
                      )}
                    </div>
                    <div className="ebay-meta">
                      <p className="ebay-title">{it.title}</p>
                      <p className="ebay-price">{it.priceDisplay}</p>
                      <p className="muted small">{it.condition}</p>
                      <button type="button" className="linkish" onClick={() => openUrl(it.itemWebUrl)}>
                        Open on eBay
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      )}

      <section className="basket-section" aria-label="Buy basket">
        <h2 className="basket-title">Buy basket / inventory</h2>
        <div className="basket-table-wrap">
          <table className="basket-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Card</th>
                <th>Paid</th>
                <th>Current value</th>
                <th>Profit / loss</th>
                <th>Method</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {basket.length === 0 ? (
                <tr>
                  <td colSpan={7} className="basket-empty-cell">
                    No cards added yet.
                  </td>
                </tr>
              ) : (
                basket.map((row) => {
                  const profit =
                    row.paidCents != null && row.currentValueCents != null
                      ? row.currentValueCents - row.paidCents
                      : null;
                  return (
                    <tr key={row.id}>
                      <td className="nowrap">{new Date(row.addedAt).toLocaleString()}</td>
                      <td>{row.cardLabel}</td>
                      <td>
                        <input
                          key={`paid-${row.id}-${row.paidCents ?? "x"}`}
                          className="basket-money-input"
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          aria-label="Paid"
                          defaultValue={
                            row.paidCents != null ? (row.paidCents / 100).toFixed(2) : ""
                          }
                          onBlur={(e) => updateBasketPaid(row.id, parseMoneyInput(e.target.value))}
                        />
                      </td>
                      <td>{formatUsd(row.currentValueCents)}</td>
                      <td className={profit != null && profit >= 0 ? "profit-pos" : profit != null ? "profit-neg" : ""}>
                        {profit != null ? formatUsd(profit) : "—"}
                      </td>
                      <td>
                        <select
                          className="basket-method-select"
                          value={row.method}
                          onChange={(e) =>
                            updateBasketMethod(row.id, e.target.value as BasketRow["method"])
                          }
                        >
                          <option value="">—</option>
                          <option value="cash">Cash</option>
                          <option value="trade">Trade</option>
                        </select>
                      </td>
                      <td>
                        <button type="button" className="linkish" onClick={() => removeBasketRow(row.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <details className="panel history-details">
        <summary className="history-details-summary">Recorded eBay comps (VPS database)</summary>
        <p className="history-lede">
          Optional: search titles your crawler stored. Uses the same composed search string as above.
        </p>
        <div className="history-fields">
          <label className="history-label" htmlFor="history-api-base">
            API base URL
          </label>
          <input
            id="history-api-base"
            type="url"
            className="history-input"
            placeholder="https://your-vps.example.com:3001"
            value={historyApiBase}
            onChange={(e) => setHistoryApiBase(e.target.value)}
            onBlur={persistHistorySettings}
            disabled={historyLoading || historyDetailLoading}
            autoComplete="off"
          />
          <label className="history-label" htmlFor="history-api-key">
            API key
          </label>
          <input
            id="history-api-key"
            type="password"
            className="history-input"
            placeholder="Bearer token from VPS .env"
            value={historyApiKey}
            onChange={(e) => setHistoryApiKey(e.target.value)}
            onBlur={persistHistorySettings}
            disabled={historyLoading || historyDetailLoading}
            autoComplete="off"
          />
        </div>
        <div className="history-actions">
          <button
            type="button"
            className="history-btn"
            onClick={() => void runHistorySearch()}
            disabled={searching || loadingCard || historyLoading || historyDetailLoading || !composedQuery}
          >
            {historyLoading ? "Querying…" : "Search recorded comps"}
          </button>
        </div>
        {historyError && (
          <div className="history-error-banner">
            <strong>VPS history:</strong> {historyError}
          </div>
        )}
        {historySnap && historySnap.results.length > 0 && (
          <div className="history-results">
            <p className="history-meta">
              Matches for “{historySnap.query}” — latest observation per listing.
            </p>
            <table className="history-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Price</th>
                  <th>Market</th>
                  <th>Seen</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {historySnap.results.map((r) => (
                  <tr key={r.ebayItemId}>
                    <td>
                      <button type="button" className="linkish table-title-btn" onClick={() => openUrl(r.pageUrl)}>
                        {r.title}
                      </button>
                    </td>
                    <td>{r.priceDisplay ?? "—"}</td>
                    <td>{r.market}</td>
                    <td className="muted small">{r.observedAt ?? "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => void loadItemHistory(r.ebayItemId)}
                        disabled={historyDetailLoading}
                      >
                        {historyDetailLoading && historyDetailForId === r.ebayItemId ? "Loading…" : "Timeline"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {historySnap && historySnap.results.length === 0 && !historyLoading && (
          <p className="history-empty muted small">No rows in the database for that query.</p>
        )}
        {historyDetail && historyDetail.history.length > 0 && (
          <div className="history-timeline">
            <h3 className="timeline-title">
              Listing {historyDetail.ebayItemId} — {historyDetail.history.length} observations
            </h3>
            <ul className="timeline-list">
              {historyDetail.history.map((h, i) => (
                <li key={`${h.observedAt ?? i}-${i}`}>
                  <span className="timeline-date">{h.observedAt ?? "?"}</span>
                  <span className="timeline-price">{h.priceDisplay ?? "—"}</span>
                  <span className="timeline-market">{h.market}</span>
                  {h.detail && <span className="timeline-detail">{h.detail}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>

      {showAbout && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowAbout(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Data sources & limitations</h3>
            <ul className="about-list">
              <li>
                <strong>PriceCharting</strong> supplies product match, reference prices per tier, and marketplace sold
                rows — not all sales everywhere.
              </li>
              <li>
                <strong>eBay</strong> uses the Browse API for <strong>active</strong> listings only.
              </li>
              <li>
                <strong>VPS history</strong> is your own crawled title search — optional.
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
