use crate::types::EbayListing;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use reqwest::Client;
use serde_json::Value;

const EBAY_TOKEN_URL: &str = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_BROWSE_SEARCH: &str = "https://api.ebay.com/buy/browse/v1/item_summary/search";

pub fn ebay_creds() -> Result<(String, String), String> {
    let id = std::env::var("EBAY_CLIENT_ID").map_err(|_| "Missing EBAY_CLIENT_ID in .env".to_string())?;
    let secret =
        std::env::var("EBAY_CLIENT_SECRET").map_err(|_| "Missing EBAY_CLIENT_SECRET in .env".to_string())?;
    Ok((id, secret))
}

pub async fn application_token(client: &Client, client_id: &str, client_secret: &str) -> Result<String, String> {
    let raw = format!("{}:{}", client_id, client_secret);
    let b64 = B64.encode(raw);
    let body = "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope";
    let res = client
        .post(EBAY_TOKEN_URL)
        .header("Authorization", format!("Basic {}", b64))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("eBay token request failed: {e}"))?;
    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("eBay OAuth error: {t}"));
    }
    let v: Value = res.json().await.map_err(|e| e.to_string())?;
    let token = v["access_token"].as_str().ok_or_else(|| "eBay token missing access_token".to_string())?;
    Ok(token.to_string())
}

/// Pokemon TCG Individual Cards (US) — narrows Browse results to card listings.
fn category_ids() -> &'static str {
    "31392"
}

pub async fn search_active_listings(client: &Client, bearer: &str, query: &str, limit: u32) -> Result<Vec<EbayListing>, String> {
    let url = format!(
        "{}?q={}&limit={}&category_ids={}",
        EBAY_BROWSE_SEARCH,
        urlencoding::encode(query),
        limit,
        category_ids()
    );
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", bearer))
        .header("X-EBAY-C-MARKETPLACE-ID", "EBAY_US")
        .send()
        .await
        .map_err(|e| format!("eBay browse failed: {e}"))?;
    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("eBay Browse API error: {t}"));
    }
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    let Some(items) = body["itemSummaries"].as_array() else {
        return Ok(vec![]);
    };
    let mut rows = Vec::new();
    for item in items {
        let title = item["title"].as_str().unwrap_or("").to_string();
        let price_val = item["price"]["value"].as_str().unwrap_or("-");
        let currency = item["price"]["currency"].as_str().unwrap_or("USD");
        let price_display = format!("{} {}", price_val, currency);
        let condition = item["condition"].as_str().unwrap_or("-").to_string();
        let image_url = item["image"]["imageUrl"]
            .as_str()
            .map(String::from)
            .or_else(|| item["thumbnailImages"][0]["imageUrl"].as_str().map(String::from));
        let item_web_url = item["itemWebUrl"].as_str().unwrap_or("").to_string();
        rows.push(EbayListing {
            title,
            price_display,
            condition,
            image_url,
            item_web_url,
        });
    }
    Ok(rows)
}
