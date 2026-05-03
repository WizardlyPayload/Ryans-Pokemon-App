import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";

const EBAY_REGION_KEY = "pokemon-desktop-ebay-region";
const HISTORY_API_BASE_KEY = "pokemon-desktop-history-api-base";
const HISTORY_API_KEY_KEY = "pokemon-desktop-history-api-key";

function isTauriApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type EbayRegion = "us" | "uk";

interface SoldScrapeRow {
  title: string;
  priceDisplay: string;
  detail: string;
  itemUrl: string;
  thumbnailUrl?: string | null;
}

interface TierBucket {
  tierKey: string;
  label: string;
  sold: SoldScrapeRow[];
  sectionNote?: string | null;
}

interface MarketSnapshot {
  query: string;
  cardName?: string | null;
  cardImageUrl?: string | null;
  tiers: TierBucket[];
  ebaySearchUrl: string;
  warnings: string[];
}

interface HistorySearchRow {
  ebayItemId: string;
  title: string;
  priceDisplay?: string | null;
  market: string;
  observedAt?: string | null;
  pageUrl: string;
}

interface HistorySearchSnapshot {
  query: string;
  results: HistorySearchRow[];
}

interface HistoryObservationRow {
  ebayItemId: string;
  title: string;
  priceDisplay?: string | null;
  detail?: string | null;
  market: string;
  observedAt?: string | null;
  thumbnailUrl?: string | null;
  pageUrl: string;
}

interface HistoryItemDetail {
  ebayItemId: string;
  history: HistoryObservationRow[];
}

function App() {
  const [q, setQ] = useState("");
  const [ebayRegion, setEbayRegion] = useState<EbayRegion>(() => {
    try {
      return localStorage.getItem(EBAY_REGION_KEY) === "uk" ? "uk" : "us";
    } catch {
      return "us";
    }
  });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [snap, setSnap] = useState<MarketSnapshot | null>(null);
  const [showNotes, setShowNotes] = useState(false);

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
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  const [historySnap, setHistorySnap] = useState<HistorySearchSnapshot | null>(null);
  const [historyDetail, setHistoryDetail] = useState<HistoryItemDetail | null>(null);
  const [historyDetailForId, setHistoryDetailForId] = useState<string | null>(null);
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false);

  const onRegionChange = (r: EbayRegion) => {
    setEbayRegion(r);
    try {
      localStorage.setItem(EBAY_REGION_KEY, r);
    } catch {
      /* ignore */
    }
  };

  const persistHistorySettings = () => {
    try {
      localStorage.setItem(HISTORY_API_BASE_KEY, historyApiBase);
      localStorage.setItem(HISTORY_API_KEY_KEY, historyApiKey);
    } catch {
      /* ignore */
    }
  };

  const runHistorySearch = useCallback(async () => {
    if (!q.trim()) {
      setHistoryErr("Enter a card name or search term above.");
      return;
    }
    if (!historyApiBase.trim()) {
      setHistoryErr("Set the VPS API base URL (e.g. https://your-host:3001).");
      return;
    }
    if (!isTauriApp()) {
      setHistoryErr("Run this app with Tauri (npm run tauri dev), not the Vite tab in a browser.");
      return;
    }
    persistHistorySettings();
    setHistoryLoading(true);
    setHistoryErr(null);
    setHistorySnap(null);
    setHistoryDetail(null);
    setHistoryDetailForId(null);
    try {
      const out = await invoke<HistorySearchSnapshot>("history_search_vps", {
        query: q.trim(),
        apiBase: historyApiBase.trim(),
        apiKey: historyApiKey,
      });
      setHistorySnap(out);
    } catch (e) {
      setHistoryErr(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  }, [q, historyApiBase, historyApiKey]);

  const loadItemHistory = useCallback(
    async (ebayItemId: string) => {
      if (!historyApiBase.trim()) {
        setHistoryErr("Set the VPS API base URL.");
        return;
      }
      if (!isTauriApp()) return;
      persistHistorySettings();
      setHistoryDetailLoading(true);
      setHistoryErr(null);
      setHistoryDetailForId(ebayItemId);
      try {
        const out = await invoke<HistoryItemDetail>("history_item_vps", {
          ebayItemId,
          apiBase: historyApiBase.trim(),
          apiKey: historyApiKey,
        });
        setHistoryDetail(out);
      } catch (e) {
        setHistoryErr(e instanceof Error ? e.message : String(e));
        setHistoryDetail(null);
      } finally {
        setHistoryDetailLoading(false);
      }
    },
    [historyApiBase, historyApiKey],
  );

  const runSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!q.trim()) return;
      if (!isTauriApp()) {
        setErr("Run this app with Tauri (npm run tauri dev), not the Vite tab in a browser.");
        return;
      }
      setLoading(true);
      setErr(null);
      setSnap(null);
      try {
        const out = await invoke<MarketSnapshot>("search_card_market", {
          query: q.trim(),
          ebay_region: ebayRegion,
          ebay_host: null,
          ebay_sacat: null,
        });
        setSnap(out);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [q, ebayRegion],
  );

  return (
    <div className="app">
      {!isTauriApp() && (
        <div className="banner">
          Open this UI inside the Tauri window (<code>npm run tauri dev</code>). Plain Vite in the
          browser cannot call Rust.
        </div>
      )}

      <header className="header">
        <h1>Pokémon card — sold comps</h1>
        <p className="sub">
          Search pulls sold listings from eBay’s HTML (scraped). Tier labels are keyword guesses
          only — not grading verification.
        </p>
      </header>

      <div className="region-row">
        <label className="region-label" htmlFor="ebay-region">
          eBay site
        </label>
        <select
          id="ebay-region"
          className="region-select"
          value={ebayRegion}
          onChange={(e) => onRegionChange(e.target.value as EbayRegion)}
          disabled={loading}
        >
          <option value="us">United States (ebay.com, Pokémon category)</option>
          <option value="uk">United Kingdom (ebay.co.uk, all categories)</option>
        </select>
      </div>

      <section className="history-panel" aria-label="VPS listing history database">
        <h2 className="history-heading">Recorded comps (your VPS)</h2>
        <p className="history-lede">
          Query the read-only API backed by your crawler. Uses the same search box below; set your
          deploy URL and API key once — they are saved locally.
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
            placeholder="Bearer token from .env"
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
            disabled={loading || historyLoading || historyDetailLoading}
          >
            {historyLoading ? "Querying…" : "Search recorded comps"}
          </button>
        </div>
        {historyErr && (
          <div className="error-box history-error">
            <strong>VPS history</strong>
            <p>{historyErr}</p>
          </div>
        )}
        {historySnap && historySnap.results.length > 0 && (
          <div className="history-results">
            <p className="history-meta">
              Matches for “{historySnap.query}” — latest observation per listing.
            </p>
            <table>
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
                {historySnap.results.map((row) => (
                  <tr key={row.ebayItemId}>
                    <td>
                      <a
                        href={row.pageUrl}
                        onClick={(e) => {
                          e.preventDefault();
                          openUrl(row.pageUrl);
                        }}
                      >
                        {row.title}
                      </a>
                    </td>
                    <td>{row.priceDisplay ?? "—"}</td>
                    <td>{row.market}</td>
                    <td className="detail">{row.observedAt ?? "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => void loadItemHistory(row.ebayItemId)}
                        disabled={historyDetailLoading}
                      >
                        {historyDetailLoading && historyDetailForId === row.ebayItemId
                          ? "Loading…"
                          : "Timeline"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {historySnap && historySnap.results.length === 0 && !historyLoading && (
          <p className="history-empty">No rows in the database for that query.</p>
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
      </section>

      <form className="search-row" onSubmit={runSearch}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='e.g. Charizard VMAX PSA 10 / "squirtle"'
          disabled={loading}
          autoComplete="off"
        />
        <button type="submit" disabled={loading}>
          {loading ? "Searching…" : "Search sold comps"}
        </button>
        <button type="button" className="ghost" onClick={() => setShowNotes(true)}>
          Important notes
        </button>
      </form>

      {err && (
        <div className="error-box">
          <strong>Error</strong>
          <p>{err}</p>
        </div>
      )}

      {snap && (
        <>
          <section className="card-strip">
            {snap.cardImageUrl && (
              <img className="hero-art" src={snap.cardImageUrl} alt="" />
            )}
            <div>
              <div className="meta">
                {snap.cardName && <span className="pill">{snap.cardName}</span>}
                <span className="pill muted">Query: {snap.query}</span>
              </div>
              <button
                type="button"
                className="linkish"
                onClick={() => openUrl(snap.ebaySearchUrl)}
              >
                Open same sold search on eBay ↗
              </button>
            </div>
          </section>

          {snap.warnings.length > 0 && (
            <ul className="warnings">
              {snap.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <div className="tiers">
            {snap.tiers.map((tier) => (
              <section key={tier.tierKey} className="tier-block">
                <h2>{tier.label}</h2>
                {tier.sectionNote && (
                  <p className="tier-note">{tier.sectionNote}</p>
                )}
                {tier.sold.length === 0 ? (
                  <p className="empty-tier">No rows in this bucket.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th></th>
                        <th>Title</th>
                        <th>Price</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tier.sold.map((row) => (
                        <tr key={row.itemUrl}>
                          <td className="thumb">
                            {row.thumbnailUrl && (
                              <img src={row.thumbnailUrl} alt="" />
                            )}
                          </td>
                          <td>
                            <a
                              href={row.itemUrl}
                              onClick={(e) => {
                                e.preventDefault();
                                openUrl(row.itemUrl);
                              }}
                            >
                              {row.title}
                            </a>
                          </td>
                          <td>{row.priceDisplay}</td>
                          <td className="detail">{row.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            ))}
          </div>
        </>
      )}

      {showNotes && (
        <div className="modal-backdrop" onClick={() => setShowNotes(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Important notes</h3>
            <ul className="notes-list">
              <li>
                Data comes from eBay’s public search HTML — not official APIs. Layout changes can
                break scraping.
              </li>
              <li>
                <strong>UK:</strong> choose <strong>United Kingdom</strong> in <strong>eBay site</strong> above
                (no env vars needed). You can still override with <code>EBAY_HOST</code> /{" "}
                <code>EBAY_SACAT</code> when launching from a terminal if you prefer.
              </li>
              <li>
                If you see no listings, eBay may be serving a JS-only page to automated clients —
                use the “Open same sold search on eBay” link or an optional render proxy (
                <code>EBAY_RENDER_PROXY_URL</code>).
              </li>
            </ul>
            <button type="button" onClick={() => setShowNotes(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
