use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProductSummary {
    pub id: String,
    pub product_name: String,
    pub console_name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProductDetails {
    pub id: String,
    pub product_name: String,
    pub console_name: String,
    pub genre: Option<String>,
    pub image_url: Option<String>,
    pub pricecharting_search_url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PcSoldOffer {
    pub offer_id: String,
    pub price_cents: i64,
    pub sale_time: Option<String>,
    pub condition_string: Option<String>,
    pub include_string: Option<String>,
    pub offer_url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TierView {
    pub tier_key: String,
    pub label: String,
    pub price_field: String,
    pub price_cents: Option<i64>,
    pub condition_id: Option<i32>,
    pub sold: Vec<PcSoldOffer>,
    pub sold_section_note: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EbayListing {
    pub title: String,
    pub price_display: String,
    pub condition: String,
    pub image_url: Option<String>,
    pub item_web_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardLoadout {
    pub product: ProductDetails,
    pub tiers: Vec<TierView>,
    pub ebay_active: Vec<EbayListing>,
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
