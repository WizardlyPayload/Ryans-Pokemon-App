import { openUrl } from "@tauri-apps/plugin-opener";
import type { CardLoadout, UnifiedEbaySaleRow } from "../types";
import {
  formatUsd,
  formatUsdDollars,
  pickReferenceCents,
} from "../lib/cardAppUtils";

type CardDetailPanelProps = {
  loadingCard: boolean;
  card: CardLoadout | null;
  lookupSource: "vps" | "official" | null;
  unifiedSales: UnifiedEbaySaleRow[];
  unifiedAvg: number | null;
  unifiedAvgCount: number;
  basketSummaryLabel: string;
  onAddToBasket: () => void;
};

/** Visible when parent has loaded card detail or is loading (unified path sets card without selectedId). */
export function CardDetailPanel({
  loadingCard,
  card,
  lookupSource,
  unifiedSales,
  unifiedAvg,
  unifiedAvgCount,
  basketSummaryLabel,
  onAddToBasket,
}: CardDetailPanelProps) {
  if (loadingCard && !card) {
    return (
      <aside className="layout-detail" aria-label="Card detail">
        <div className="panel detail-loading-panel">
          <p className="muted">Loading card…</p>
        </div>
      </aside>
    );
  }

  if (!card) {
    return null;
  }

  return (
    <aside className="layout-detail" aria-label="Card detail">
      <main className="main">
        <section className="panel card-actions-bar">
          <div>
            <strong>Loaded:</strong> {basketSummaryLabel}
            {pickReferenceCents(card) != null && (
              <span className="ref-price"> · Ref. {formatUsd(pickReferenceCents(card))}</span>
            )}
          </div>
          <button type="button" className="primary" onClick={onAddToBasket}>
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
            {lookupSource === "vps" && card.product.cardVariant && (
              <p className="muted small">
                <strong>Variant:</strong> {card.product.cardVariant}
              </p>
            )}
            {lookupSource === "vps" && card.product.populationSummaryText && (
              <p className="muted small">
                <strong>Population:</strong> {card.product.populationSummaryText}
              </p>
            )}
            <button
              type="button"
              className="linkish"
              onClick={() => openUrl(card.product.pricechartingSearchUrl)}
            >
              {lookupSource === "vps" ? "Open PriceCharting product page" : "Open PriceCharting search"}
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
          <h3>{lookupSource === "vps" ? "Guide grades & prices (your VPS scrape)" : "Condition tiers (PriceCharting)"}</h3>
          <p className="tier-intro muted">
            {lookupSource === "vps"
              ? "Structured grade rows from your cached snapshot (same data as the database). Marketplace sold tables are not replayed here."
              : "Reference prices and recent sold rows from the PriceCharting marketplace per condition bucket (when available)."}
          </p>
          <div className="tier-list">
            {card.tiers.map((tier) => (
              <details key={tier.tierKey} className="tier" open={tier.tierKey === "loose"}>
                <summary>
                  <span className="tier-title">{tier.label}</span>
                  <span className="tier-price">{formatUsd(tier.priceCents ?? null)}</span>
                </summary>
                <div className="tier-body">
                  {lookupSource === "vps" ? (
                    <p className="muted small">Guide price from your latest VPS scrape snapshot for this grade.</p>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>

        <section className="ebay-section">
          {lookupSource === "vps" && (
            <div className="panel">
              <h3>Recent eBay sold (last 30)</h3>
              <p className="muted small">
                Average of last {unifiedAvgCount} sales: <strong>{formatUsdDollars(unifiedAvg)}</strong>
              </p>
              {unifiedSales.length === 0 ? (
                <p className="muted small">No recent sold rows found for this query.</p>
              ) : (
                <div className="history-table-scroll">
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Sold</th>
                        <th>Market</th>
                        <th>Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unifiedSales.map((r, i) => (
                        <tr key={`${r.ebayItemId}-${i}`}>
                          <td>
                            <button type="button" className="linkish table-title-btn" onClick={() => openUrl(r.pageUrl)}>
                              {r.title}
                            </button>
                          </td>
                          <td>{r.priceDisplay ?? formatUsdDollars(r.priceValue ?? null)}</td>
                          <td>{r.market}</td>
                          <td className="muted small">{r.observedAt ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <h3>Active listings (eBay)</h3>
          <p className="ebay-disclaimer">
            Currently active listings on eBay (US, Pokémon TCG singles) - not completed sales.
          </p>
          {card.ebayActive.length === 0 ? (
            <p className="muted">
              {lookupSource === "vps"
                ? "Live eBay listings are not fetched in VPS scrape mode. Add EBAY_CLIENT_ID / EBAY_CLIENT_SECRET for active listings, or use Recorded eBay sales below."
                : "No listings returned (check credentials or try another card)."}
            </p>
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
    </aside>
  );
}
