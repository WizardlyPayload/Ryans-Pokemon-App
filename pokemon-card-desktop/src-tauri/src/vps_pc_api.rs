use crate::types::{MarketCompareSnapshot, PcProductDetailResponse, PcSearchSnapshot};
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

pub async fn fetch_pc_search(
    client: &Client,
    api_base: String,
    api_key: String,
    query: String,
) -> Result<PcSearchSnapshot, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("Enter a search query.".into());
    }
    let base = normalize_api_base(&api_base);
    if base.is_empty() {
        return Err("Set PC_API_BASE in pokemon-card-desktop/.env or enter it in the form.".into());
    }
    let url = format!("{}/v1/pc/search?q={}", base, urlencoding::encode(q));
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .send()
        .await
        .map_err(|e| format!("VPS PC API request failed: {e}"))?;
    let status = res.status();
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("VPS PC API: read body failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("VPS PC API HTTP {status}: {}", truncate_body_hint(&bytes)));
    }
    decode_json_body::<PcSearchSnapshot>(&bytes, "VPS PC search JSON")
}

pub async fn fetch_pc_product(
    client: &Client,
    api_base: String,
    api_key: String,
    product_id: String,
) -> Result<PcProductDetailResponse, String> {
    let id = product_id.trim().replace(|c: char| !c.is_ascii_digit(), "");
    if id.is_empty() {
        return Err("Invalid PriceCharting product id.".into());
    }
    let base = normalize_api_base(&api_base);
    if base.is_empty() {
        return Err("Set PC_API_BASE.".into());
    }
    let url = format!("{}/v1/pc/product/{id}", base);
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .send()
        .await
        .map_err(|e| format!("VPS PC API request failed: {e}"))?;
    let status = res.status();
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("VPS PC API: read body failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("VPS PC API HTTP {status}: {}", truncate_body_hint(&bytes)));
    }
    decode_json_body::<PcProductDetailResponse>(&bytes, "VPS PC product JSON")
}

pub async fn fetch_market_compare(
    client: &Client,
    api_base: String,
    api_key: String,
    query: String,
) -> Result<MarketCompareSnapshot, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("Enter a search query.".into());
    }
    let base = normalize_api_base(&api_base);
    if base.is_empty() {
        return Err("Set PC_API_BASE.".into());
    }
    let url = format!("{}/v1/compare?q={}", base, urlencoding::encode(q));
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .send()
        .await
        .map_err(|e| format!("VPS compare API request failed: {e}"))?;
    let status = res.status();
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("VPS compare API: read body failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("VPS compare API HTTP {status}: {}", truncate_body_hint(&bytes)));
    }
    decode_json_body::<MarketCompareSnapshot>(&bytes, "VPS compare JSON")
}
