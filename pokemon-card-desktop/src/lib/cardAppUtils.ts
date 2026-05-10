import type {
  BasketRow,
  CardLoadout,
  PcProductDetailResponse,
  TierView,
} from "../types";

export const HISTORY_API_BASE_KEY = "pokemon-desktop-history-api-base";
export const HISTORY_API_KEY_KEY = "pokemon-desktop-history-api-key";
export const HISTORY_LAST_QUERY_KEY = "pokemon-desktop-history-last-query";
export const PC_API_BASE_KEY = "pokemon-desktop-pcApi-pc-api-base";
export const PC_API_KEY_KEY = "pokemon-desktop-pcApi-pc-api-key";
export const PC_LAST_QUERY_KEY = "pokemon-desktop-pcApi-last-query";
export const BASKET_KEY = "pokemon-buy-basket";

export function formatUsd(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** Match crawler-side cleanup so UI shows compact sold prices. */
export function formatHistoryPrice(raw: string | null | undefined): string {
  if (raw == null || !String(raw).trim()) return "—";
  let t = String(raw).replace(/\s+/g, " ").trim();
  t = t.replace(/\s*or\s*best\s*offer\b/gi, "").replace(/\s+/g, " ").trim();
  return t || "—";
}

export function parseMoneyInput(raw: string): number | null {
  const t = raw.trim().replace(/[$,]/g, "");
  if (!t) return null;
  const n = Number.parseFloat(t);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

export function buildNarrowQuery(p: {
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

export function pickReferenceCents(card: CardLoadout): number | null {
  const loose = card.tiers.find((t) => t.tierKey === "loose");
  if (loose?.priceCents != null) return loose.priceCents;
  for (const t of card.tiers) {
    if (t.priceCents != null) return t.priceCents;
  }
  return null;
}

export function tierKeyFromScrapedGrade(label: string, index: number): string {
  const L = label.trim();
  if (/ungraded/i.test(L)) return "loose";
  if (/psa\s*10\b/i.test(L)) return "graded:psa10";
  if (/psa\s*9\b/i.test(L)) return "graded:psa9";
  if (/bgs\s*10\b/i.test(L)) return "graded:bgs10";
  return `scraped-${index}`;
}

export function mapVpsProductToCardLoadout(detail: PcProductDetailResponse): CardLoadout {
  const p = detail.product;
  const snap = detail.latestSnapshot;
  const tiersJson = snap?.tiers;
  let grades: Array<{ grade?: string; priceDisplay?: string; priceUsd?: number | null }> = [];
  if (
    tiersJson &&
    typeof tiersJson === "object" &&
    "grades" in tiersJson &&
    Array.isArray((tiersJson as { grades: unknown }).grades)
  ) {
    grades = (tiersJson as { grades: typeof grades }).grades;
  }

  const tierViews: TierView[] = grades.map((g, i) => {
    const label = g.grade ?? `Tier ${i + 1}`;
    const pcUsd = g.priceUsd;
    const cents =
      pcUsd != null && Number.isFinite(Number(pcUsd)) ? Math.round(Number(pcUsd) * 100) : null;
    return {
      tierKey: tierKeyFromScrapedGrade(label, i),
      label,
      priceField: "scrapedGuide",
      priceCents: cents,
      conditionId: null,
      sold: [],
      soldSectionNote: undefined,
    };
  });

  let genre: string | undefined;
  const ex = snap?.extras;
  if (ex && typeof ex === "object" && Array.isArray((ex as { detailRows?: unknown }).detailRows)) {
    const rows = (ex as { detailRows: Array<{ label?: string; value?: string }> }).detailRows;
    const row = rows.find((r) => /genre/i.test(String(r.label)));
    genre = row?.value?.trim();
  }

  const metaBits = [p.cardNumber, p.releaseDate, p.publisher].filter(Boolean).join(" · ");
  const warnings: string[] = [
    "Prices from your private VPS scrape (cached HTML), not the live PriceCharting API.",
    ...(metaBits ? [`Catalog: ${metaBits}`] : []),
    "eBay active listings were not loaded (add EBAY_CLIENT_ID / EBAY_CLIENT_SECRET for live comps).",
  ];

  return {
    product: {
      id: p.pcProductId,
      productName: p.title,
      consoleName: p.consoleOrCategory ?? "",
      genre,
      imageUrl: p.imageUrl ?? undefined,
      pricechartingSearchUrl: p.productUrl,
    },
    tiers: tierViews,
    ebayActive: [],
    warnings,
  };
}

export function formatUsdDollars(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function tiersPreview(tiers: unknown): string {
  if (tiers && typeof tiers === "object" && "grades" in tiers) {
    const gr = (tiers as { grades?: Array<{ grade?: string; priceDisplay?: string }> }).grades;
    if (Array.isArray(gr) && gr.length > 0) {
      const line = gr.map((x) => `${x.grade ?? "?"}: ${x.priceDisplay ?? "—"}`).join(" · ");
      return line.slice(0, 360) + (line.length > 360 ? "..." : "");
    }
  }
  if (tiers && typeof tiers === "object" && "gridText" in tiers) {
    const g = (tiers as { gridText?: string }).gridText;
    if (typeof g === "string" && g.trim())
      return g.trim().slice(0, 280) + (g.length > 280 ? "..." : "");
  }
  try {
    return JSON.stringify(tiers).slice(0, 200);
  } catch {
    return "—";
  }
}

export function loadBasket(): BasketRow[] {
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
