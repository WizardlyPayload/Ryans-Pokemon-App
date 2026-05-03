use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SoldScrapeRow {
    pub title: String,
    pub price_display: String,
    pub detail: String,
    pub item_url: String,
    pub thumbnail_url: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TierBucket {
    pub tier_key: String,
    pub label: String,
    pub sold: Vec<SoldScrapeRow>,
    pub section_note: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketSnapshot {
    pub query: String,
    pub card_name: Option<String>,
    pub card_image_url: Option<String>,
    pub tiers: Vec<TierBucket>,
    pub ebay_search_url: String,
    pub warnings: Vec<String>,
}

/// VPS history API: GET /v1/search
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistorySearchSnapshot {
    pub query: String,
    pub results: Vec<HistorySearchRow>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistorySearchRow {
    pub ebay_item_id: String,
    pub title: String,
    pub price_display: Option<String>,
    pub market: String,
    pub observed_at: Option<String>,
    pub page_url: String,
}

/// VPS history API: GET /v1/item/:id/history
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItemDetail {
    pub ebay_item_id: String,
    pub history: Vec<HistoryObservationRow>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryObservationRow {
    pub ebay_item_id: String,
    pub title: String,
    pub price_display: Option<String>,
    pub detail: Option<String>,
    pub market: String,
    pub observed_at: Option<String>,
    pub thumbnail_url: Option<String>,
    pub page_url: String,
}
