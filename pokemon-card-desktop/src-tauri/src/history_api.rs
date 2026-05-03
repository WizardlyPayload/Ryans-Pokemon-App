use crate::types::{HistoryItemDetail, HistorySearchSnapshot};
use reqwest::Client;

fn normalize_api_base(base: &str) -> String {
    let mut s = base.trim().trim_end_matches('/').to_string();
    if s.ends_with("/v1") {
        s.truncate(s.len() - 3);
        s = s.trim_end_matches('/').to_string();
    }
    s
}

pub async fn fetch_history_search(
    client: &Client,
    api_base: String,
    api_key: String,
    query: String,
) -> Result<HistorySearchSnapshot, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("Enter a search query.".into());
    }
    let base = normalize_api_base(&api_base);
    if base.is_empty() {
        return Err("Set the VPS history API base URL (e.g. https://your-host:3001).".into());
    }
    let url = format!(
        "{}/v1/search?q={}",
        base,
        urlencoding::encode(q)
    );
    let res = client
        .get(&url)
        .header(
            "Authorization",
            format!("Bearer {}", api_key.trim()),
        )
        .send()
        .await
        .map_err(|e| format!("History API request failed: {e}"))?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("History API error HTTP {status}: {body}"));
    }
    res.json::<HistorySearchSnapshot>()
        .await
        .map_err(|e| format!("History API JSON: {e}"))
}

pub async fn fetch_item_history(
    client: &Client,
    api_base: String,
    api_key: String,
    ebay_item_id: String,
) -> Result<HistoryItemDetail, String> {
    let id = ebay_item_id.trim().replace(|c: char| !c.is_ascii_digit(), "");
    if id.len() < 10 {
        return Err("Invalid eBay item id.".into());
    }
    let base = normalize_api_base(&api_base);
    if base.is_empty() {
        return Err("Set the VPS history API base URL.".into());
    }
    let url = format!("{}/v1/item/{}/history", base, id);
    let res = client
        .get(&url)
        .header(
            "Authorization",
            format!("Bearer {}", api_key.trim()),
        )
        .send()
        .await
        .map_err(|e| format!("History API request failed: {e}"))?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("History API error HTTP {status}: {body}"));
    }
    res.json::<HistoryItemDetail>()
        .await
        .map_err(|e| format!("History API JSON: {e}"))
}
