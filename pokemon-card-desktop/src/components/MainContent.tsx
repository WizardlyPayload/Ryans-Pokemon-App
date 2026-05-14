import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  HistoryItemDetail,
  HistorySearchSnapshot,
  MarketCompareSnapshot,
  PcSearchSnapshot,
  ProductSummary,
  UnifiedSearchSnapshot,
} from "../types";
import { formatHistoryPrice, tiersPreview } from "../lib/cardAppUtils";
import { UnifiedMarketHub } from "./UnifiedMarketHub";

type MainContentProps = {
  composedQuery: string;
  cardName: string;
  setCardName: (v: string) => void;
  setName: string;
  setSetName: (v: string) => void;
  cardNumber: string;
  setCardNumber: (v: string) => void;
  variantNotes: string;
  setVariantNotes: (v: string) => void;
  gradingCompany: string;
  setGradingCompany: (v: string) => void;
  grade: string;
  setGrade: (v: string) => void;
  language: string;
  setLanguage: (v: string) => void;
  sealed: string;
  setSealed: (v: string) => void;
  onGetCardValue: () => void;
  liveSearch: boolean;
  onLiveSearchChange: (v: boolean) => void;
  searching: boolean;
  loadingCard: boolean;
  historyApiBase: string;
  setHistoryApiBase: (v: string) => void;
  historyApiKey: string;
  setHistoryApiKey: (v: string) => void;
  onPersistHistorySettings: () => void;
  historySearchQuery: string;
  setHistorySearchQuery: (v: string) => void;
  onRunHistorySearch: () => void;
  historyLoading: boolean;
  historyDetailLoading: boolean;
  historyError: string | null;
  historySnap: HistorySearchSnapshot | null;
  filteredHistoryRows: HistorySearchSnapshot["results"];
  historyMarketFilter: "all" | "uk" | "us";
  setHistoryMarketFilter: (v: "all" | "uk" | "us") => void;
  onLoadItemHistory: (ebayItemId: string) => void;
  historyDetail: HistoryItemDetail | null;
  historyDetailForId: string | null;
  pcApiEnvHint: { hasEnvBase: boolean; hasEnvKey: boolean };
  pcApiApiBase: string;
  setpcApiApiBase: (v: string) => void;
  pcApiApiKey: string;
  setpcApiApiKey: (v: string) => void;
  onPersistPcApiSettings: () => void;
  pcApiSearchQuery: string;
  setpcApiSearchQuery: (v: string) => void;
  onRunPcApiSearch: () => void;
  onRunPcApiCompare: () => void;
  pcApiLoading: boolean;
  pcApiCompareLoading: boolean;
  pcApiError: string | null;
  pcApiPcSnap: PcSearchSnapshot | null;
  pcApiCompareSnap: MarketCompareSnapshot | null;
  hits: ProductSummary[];
  selectedId: string | null;
  setSelectedId: (v: string | null) => void;
  lookupSource: "vps" | "official" | null;
  onLoadDetailsVps: (id: string) => void;
  onLoadDetailsOfficial: (id: string) => void;
  error: string | null;
  vpsReady: boolean;
  onAddUnifiedToBasket: (snap: UnifiedSearchSnapshot) => void;
};

export function MainContent(props: MainContentProps) {
  const {
    composedQuery,
    cardName,
    setCardName,
    setName,
    setSetName,
    cardNumber,
    setCardNumber,
    variantNotes,
    setVariantNotes,
    gradingCompany,
    setGradingCompany,
    grade,
    setGrade,
    language,
    setLanguage,
    sealed,
    setSealed,
    onGetCardValue,
    liveSearch,
    onLiveSearchChange,
    searching,
    loadingCard,
    historyApiBase,
    setHistoryApiBase,
    historyApiKey,
    setHistoryApiKey,
    onPersistHistorySettings,
    historySearchQuery,
    setHistorySearchQuery,
    onRunHistorySearch,
    historyLoading,
    historyDetailLoading,
    historyError,
    historySnap,
    filteredHistoryRows,
    historyMarketFilter,
    setHistoryMarketFilter,
    onLoadItemHistory,
    historyDetail,
    historyDetailForId,
    pcApiEnvHint,
    pcApiApiBase,
    setpcApiApiBase,
    pcApiApiKey,
    setpcApiApiKey,
    onPersistPcApiSettings,
    pcApiSearchQuery,
    setpcApiSearchQuery,
    onRunPcApiSearch,
    onRunPcApiCompare,
    pcApiLoading,
    pcApiCompareLoading,
    pcApiError,
    pcApiPcSnap,
    pcApiCompareSnap,
    hits,
    selectedId,
    setSelectedId,
    lookupSource,
    onLoadDetailsVps,
    onLoadDetailsOfficial,
    error,
    vpsReady,
    onAddUnifiedToBasket,
  } = props;

  return (
    <div className="layout-main">
      <UnifiedMarketHub
        vpsReady={vpsReady}
        pcApiApiBase={pcApiApiBase}
        pcApiApiKey={pcApiApiKey}
        onPersistPcApiSettings={onPersistPcApiSettings}
        onAddToBasket={onAddUnifiedToBasket}
      />

      <div className="my-10 border-t border-slate-200/80 pt-10">
        <h2 className="mb-1 text-lg font-semibold text-slate-800">Advanced tools</h2>
        <p className="mb-6 text-sm text-slate-500">
          Narrow fields, recorded eBay search, and raw VPS DB panels — use when you need more than the market search
          above.
        </p>
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
          onClick={() => void onGetCardValue()}
          disabled={searching || loadingCard || !composedQuery}
        >
          {searching || loadingCard ? "Loading…" : "Get card value"}
        </button>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={liveSearch}
            onChange={(e) => onLiveSearchChange(e.target.checked)}
          />
          Live search (debounced ~750ms, min 4 characters)
        </label>
        <p className="muted small purchase-sheet-hint">
          Uses your <strong>VPS scrape cache</strong> when <code>PC_API_BASE</code> / <code>PC_API_KEY</code> are set
          (same as the panel below); otherwise falls back to the PriceCharting API token.
        </p>
      </section>

      <section className="panel history-panel history-panel-main" aria-label="Recorded eBay sales">
        <h2 className="history-heading-main">Recorded eBay sales (your crawler)</h2>
        <p className="history-lede">
          Search titles stored on your VPS - shows latest observation per listing with <strong>sold price</strong> when
          captured.
        </p>
        <div className="history-fields">
          <label className="history-label" htmlFor="history-api-base-main">
            API base URL
          </label>
          <input
            id="history-api-base-main"
            type="url"
            className="history-input"
            placeholder="https://your-vps.example.com:3001"
            value={historyApiBase}
            onChange={(e) => setHistoryApiBase(e.target.value)}
            onBlur={onPersistHistorySettings}
            disabled={historyLoading || historyDetailLoading}
            autoComplete="off"
          />
          <label className="history-label" htmlFor="history-api-key-main">
            API key
          </label>
          <input
            id="history-api-key-main"
            type="password"
            className="history-input"
            placeholder="Bearer token from VPS"
            value={historyApiKey}
            onChange={(e) => setHistoryApiKey(e.target.value)}
            onBlur={onPersistHistorySettings}
            disabled={historyLoading || historyDetailLoading}
            autoComplete="off"
          />
        </div>

        <div className="history-search-row">
          <label className="history-search-label" htmlFor="history-q">
            Search listings
          </label>
          <div className="history-search-controls">
            <input
              id="history-q"
              type="search"
              className="history-search-input"
              placeholder="e.g. Charizard holo base, Pikachu promo..."
              value={historySearchQuery}
              onChange={(e) => setHistorySearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onRunHistorySearch();
              }}
              disabled={historyLoading || historyDetailLoading}
              autoComplete="off"
            />
            <button
              type="button"
              className="history-btn history-btn-secondary"
              onClick={() => setHistorySearchQuery(composedQuery)}
              disabled={!composedQuery || historyLoading || historyDetailLoading}
              title="Copy the composed purchase-sheet string into the search box"
            >
              Use purchase sheet string
            </button>
            <button
              type="button"
              className="history-btn history-btn-primary"
              onClick={() => void onRunHistorySearch()}
              disabled={historyLoading || historyDetailLoading || !historySearchQuery.trim()}
            >
              {historyLoading ? "Searching..." : "Search"}
            </button>
          </div>
        </div>

        <div className="history-market-bar" role="group" aria-label="Filter by marketplace">
          <span className="history-market-label">Market:</span>
          {(
            [
              ["all", "All"],
              ["uk", "UK"],
              ["us", "US"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`market-filter-btn ${historyMarketFilter === key ? "active" : ""}`}
              onClick={() => setHistoryMarketFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {historyError && (
          <div className="history-error-banner">
            <strong>eBay history API:</strong> {historyError}
          </div>
        )}

        {historySnap && filteredHistoryRows.length > 0 && (
          <div className="history-results">
            <p className="history-meta">
              {filteredHistoryRows.length} of {historySnap.results.length} match "{historySnap.query}"
              {historyMarketFilter !== "all" ? ` (${historyMarketFilter.toUpperCase()} only)` : ""}.
            </p>
            <div className="history-table-scroll">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th className="col-price">Sold price</th>
                    <th>Market</th>
                    <th>Seen</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistoryRows.map((r) => (
                    <tr key={r.ebayItemId}>
                      <td>
                        <button type="button" className="linkish table-title-btn" onClick={() => openUrl(r.pageUrl)}>
                          {r.title}
                        </button>
                      </td>
                      <td className="history-price-cell">{formatHistoryPrice(r.priceDisplay)}</td>
                      <td>{r.market}</td>
                      <td className="muted small">{r.observedAt ?? "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => void onLoadItemHistory(r.ebayItemId)}
                          disabled={historyDetailLoading}
                        >
                          {historyDetailLoading && historyDetailForId === r.ebayItemId ? "Loading..." : "Timeline"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {historySnap && filteredHistoryRows.length === 0 && !historyLoading && (
          <p className="history-empty muted small">
            {historySnap.results.length === 0
              ? "No rows in the database for that query."
              : "No rows for this market filter - try All."}
          </p>
        )}
        {historyDetail && historyDetail.history.length > 0 && (
          <div className="history-timeline">
            <h3 className="timeline-title">
              Listing {historyDetail.ebayItemId} - {historyDetail.history.length} observations
            </h3>
            <ul className="timeline-list">
              {historyDetail.history.map((h, i) => (
                <li key={`${h.observedAt ?? i}-${i}`}>
                  <span className="timeline-date">{h.observedAt ?? "?"}</span>
                  <span className="timeline-price">{formatHistoryPrice(h.priceDisplay)}</span>
                  <span className="timeline-market">{h.market}</span>
                  {h.detail && <span className="timeline-detail">{h.detail}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="panel history-panel pcApi-panel" aria-label="Scraped PriceCharting via pcApi">
        <h2 className="history-heading-main">Scraped PriceCharting + compare (VPS)</h2>
        <p className="history-lede">
          Uses your private VPS stack: <strong>/v1/pc/search</strong> and <strong>/v1/compare</strong>. Set{" "}
          <code>PC_API_BASE</code> / <code>PC_API_KEY</code> in <code>.env</code>, or enter below.
          {(pcApiEnvHint.hasEnvBase || pcApiEnvHint.hasEnvKey) && (
            <span className="muted small"> Rust loaded defaults from env where set.</span>
          )}
        </p>
        <div className="history-fields">
          <label className="history-label" htmlFor="pcApi-api-base">
            API base URL
          </label>
          <input
            id="pcApi-api-base"
            type="url"
            className="history-input"
            placeholder="https://your-vps.example.com:3001"
            value={pcApiApiBase}
            onChange={(e) => setpcApiApiBase(e.target.value)}
            onBlur={onPersistPcApiSettings}
            disabled={pcApiLoading || pcApiCompareLoading}
            autoComplete="off"
          />
          <label className="history-label" htmlFor="pcApi-api-key">
            API key (same as server API_KEY)
          </label>
          <input
            id="pcApi-api-key"
            type="password"
            className="history-input"
            placeholder={pcApiEnvHint.hasEnvKey ? "Using PC_API_KEY from .env (optional override)" : "Bearer secret"}
            value={pcApiApiKey}
            onChange={(e) => setpcApiApiKey(e.target.value)}
            onBlur={onPersistPcApiSettings}
            disabled={pcApiLoading || pcApiCompareLoading}
            autoComplete="off"
          />
        </div>
        <div className="history-search-row">
          <label className="history-search-label" htmlFor="pcApi-q">
            Search scraped DB / compare
          </label>
          <div className="history-search-controls">
            <input
              id="pcApi-q"
              type="search"
              className="history-search-input"
              placeholder="e.g. Pikachu Base Set..."
              value={pcApiSearchQuery}
              onChange={(e) => setpcApiSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onRunPcApiSearch();
              }}
              disabled={pcApiLoading || pcApiCompareLoading}
              autoComplete="off"
            />
            <button
              type="button"
              className="history-btn history-btn-secondary"
              onClick={() => setpcApiSearchQuery(composedQuery)}
              disabled={!composedQuery || pcApiLoading || pcApiCompareLoading}
            >
              Use purchase sheet string
            </button>
            <button
              type="button"
              className="history-btn history-btn-primary"
              onClick={() => void onRunPcApiSearch()}
              disabled={pcApiLoading || pcApiCompareLoading || !pcApiSearchQuery.trim()}
            >
              {pcApiLoading ? "Searching..." : "Search PC cache"}
            </button>
            <button
              type="button"
              className="history-btn history-btn-secondary"
              onClick={() => void onRunPcApiCompare()}
              disabled={pcApiCompareLoading || pcApiLoading || !pcApiSearchQuery.trim()}
            >
              {pcApiCompareLoading ? "Comparing..." : "Compare vs eBay comps"}
            </button>
          </div>
        </div>
        {pcApiError && (
          <div className="history-error-banner">
            <strong>VPS API:</strong> {pcApiError}
          </div>
        )}
        {pcApiPcSnap && pcApiPcSnap.results.length > 0 && (
          <div className="history-results">
            <p className="history-meta">
              PriceCharting scrape cache: {pcApiPcSnap.results.length} row(s) for "{pcApiPcSnap.query}".
            </p>
            <div className="history-table-scroll">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Thumb</th>
                    <th>Title / meta</th>
                    <th>Grades & prices</th>
                    <th>Snapshot</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pcApiPcSnap.results.map((r) => (
                    <tr key={r.pcProductId}>
                      <td>
                        {r.imageUrl ? (
                          <img src={r.imageUrl} alt="" className="pcApi-thumb" />
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                      <td>
                        <button type="button" className="linkish table-title-btn" onClick={() => openUrl(r.productUrl)}>
                          {r.title}
                        </button>
                        <div className="muted small pc-meta-line">
                          {[r.consoleOrCategory, r.cardNumber, r.releaseDate, r.publisher]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="muted small">{tiersPreview(r.tiers)}</td>
                      <td className="muted small">{r.snapshotAt ?? "—"}</td>
                      <td>
                        <span className="muted small">id {r.pcProductId}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {pcApiPcSnap && pcApiPcSnap.results.length === 0 && !pcApiLoading && (
          <p className="history-empty muted small">No scraped PriceCharting rows for that query - run the pc-crawler on the VPS.</p>
        )}
        {pcApiCompareSnap && (
          <div className="compare-split">
            <h3 className="timeline-title">eBay comps (same query)</h3>
            <div className="history-table-scroll">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th className="col-price">Sold price</th>
                    <th>Mkt</th>
                  </tr>
                </thead>
                <tbody>
                  {pcApiCompareSnap.ebay.results.map((r) => (
                    <tr key={r.ebayItemId}>
                      <td>
                        <button type="button" className="linkish table-title-btn" onClick={() => openUrl(r.pageUrl)}>
                          {r.title}
                        </button>
                      </td>
                      <td className="history-price-cell">{formatHistoryPrice(r.priceDisplay)}</td>
                      <td>{r.market}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {hits.length > 1 && (
        <section className="panel hits-panel">
          <h2 className="panel-title">Choose product match</h2>
          <p className="muted small">
            {lookupSource === "vps"
              ? "Multiple matches in your VPS scrape cache. Pick one, then load."
              : "Multiple PriceCharting products matched your narrowed search. Pick one, then load."}
          </p>
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
            onClick={() =>
              selectedId &&
              void (lookupSource === "vps" ? onLoadDetailsVps(selectedId) : onLoadDetailsOfficial(selectedId))
            }
            disabled={!selectedId || loadingCard || lookupSource == null}
          >
            {loadingCard ? "Loading..." : "Load selected card data"}
          </button>
        </section>
      )}

      </div>

      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
