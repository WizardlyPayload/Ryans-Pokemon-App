use crate::types::{HistoryItemDetail, HistorySearchSnapshot};
use reqwest::Client;
use serde::de::DeserializeOwned;

fn normalize_api_base(base: &str) -> String {
    let mut s = base.trim().trim_end_matches('/').to_string();
    if s.ends_with("/v1") {
        s.truncate(s.len() - 3);
        s = s.trim_end_matches('/').to_string();
    }
    s
}

fn truncate_body_hint(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).chars().take(400).collect()
}

fn decode_json_body<T: DeserializeOwned>(bytes: &[u8], label: &str) -> Result<T, String> {
    serde_json::from_slice(bytes).map_err(|e| {
        format!(
            "{} — {e}. First bytes of response: {}",
            label,
            truncate_body_hint(bytes)
        )
    })
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
    let status = res.status();
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("History API: read body failed: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "History API HTTP {status}: {}",
            truncate_body_hint(&bytes)
        ));
    }
    decode_json_body::<HistorySearchSnapshot>(
        &bytes,
        "History API response is not the expected JSON (check API base URL and that the server is ebay-history-stack Fastify, not another site)",
    )
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
    let status = res.status();
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("History API: read body failed: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "History API HTTP {status}: {}",
            truncate_body_hint(&bytes)
        ));
    }
    decode_json_body::<HistoryItemDetail>(
        &bytes,
        "History API response is not the expected JSON (check URL and server)",
    )
}
