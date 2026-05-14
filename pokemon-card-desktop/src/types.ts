export type ProductSummary = {
  id: string;
  productName: string;
  consoleName: string;
};

export type PcSoldOffer = {
  offerId: string;
  priceCents: number;
  saleTime?: string;
  conditionString?: string;
  includeString?: string;
  offerUrl: string;
};

export type TierView = {
  tierKey: string;
  label: string;
  priceField: string;
  priceCents: number | null;
  conditionId: number | null;
  sold: PcSoldOffer[];
  soldSectionNote?: string;
};

export type EbayListing = {
  title: string;
  priceDisplay: string;
  condition: string;
  imageUrl?: string;
  itemWebUrl: string;
};

export type CardLoadout = {
  product: {
    id: string;
    productName: string;
    consoleName: string;
    genre?: string;
    imageUrl?: string;
    pricechartingSearchUrl: string;
    /** From VPS scrape when present */
    cardVariant?: string | null;
    populationSummaryText?: string | null;
  };
  tiers: TierView[];
  ebayActive: EbayListing[];
  warnings: string[];
};

export type HistorySearchRow = {
  ebayItemId: string;
  title: string;
  priceDisplay?: string | null;
  market: string;
  observedAt?: string | null;
  pageUrl: string;
};

export type HistorySearchSnapshot = {
  query: string;
  results: HistorySearchRow[];
};

export type HistoryObservationRow = {
  ebayItemId: string;
  title: string;
  priceDisplay?: string | null;
  detail?: string | null;
  market: string;
  observedAt?: string | null;
  thumbnailUrl?: string | null;
  pageUrl: string;
};

export type HistoryItemDetail = {
  ebayItemId: string;
  history: HistoryObservationRow[];
};

export type PcSearchRow = {
  pcProductId: string;
  title: string;
  consoleOrCategory?: string | null;
  productUrl: string;
  imageUrl?: string | null;
  cardNumber?: string | null;
  releaseDate?: string | null;
  publisher?: string | null;
  cardVariant?: string | null;
  populationSummary?: Record<string, unknown> | null;
  tiers: Record<string, unknown>;
  snapshotAt?: string | null;
  parseVersion?: string | null;
};

export type PcSearchSnapshot = {
  query: string;
  results: PcSearchRow[];
};

export type MarketCompareSnapshot = {
  query: string;
  pricecharting: PcSearchSnapshot;
  ebay: HistorySearchSnapshot;
};

export type BasketRow = {
  id: string;
  addedAt: string;
  cardLabel: string;
  paidCents: number | null;
  currentValueCents: number | null;
  method: "cash" | "trade" | "";
};

export type PcProductDetailProduct = {
  pcProductId: string;
  title: string;
  consoleOrCategory?: string | null;
  productUrl: string;
  imageUrl?: string | null;
  cardNumber?: string | null;
  releaseDate?: string | null;
  publisher?: string | null;
  cardVariant?: string | null;
  populationSummary?: Record<string, unknown> | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
};

export type PcLatestSnapshot = {
  tiers: Record<string, unknown>;
  extras?: Record<string, unknown> | null;
  observedAt?: string | null;
  parseVersion?: string | null;
};

export type PcProductDetailResponse = {
  product: PcProductDetailProduct;
  latestSnapshot?: PcLatestSnapshot | null;
};

export type UnifiedEbaySaleRow = {
  ebayItemId: string;
  title: string;
  priceDisplay?: string | null;
  priceValue?: number | null;
  market: string;
  observedAt?: string | null;
  pageUrl: string;
};

export type UnifiedSearchSnapshot = {
  query: string;
  product?: PcProductDetailProduct | null;
  latestSnapshot?: PcLatestSnapshot | null;
  ebayRecentSales: UnifiedEbaySaleRow[];
  ebayAverageLast30?: number | null;
  ebayAverageLast30Count: number;
};
