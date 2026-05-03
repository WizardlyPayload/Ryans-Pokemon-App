mod ebay_scrape;
mod history_api;
mod pokemon_tcg;
mod tier_classify;
mod types;

use ebay_scrape::EbaySiteConfig;
use reqwest::Client;
use types::{HistoryItemDetail, HistorySearchSnapshot, MarketSnapshot};

pub struct HttpClient(pub Client);

#[tauri::command]
async fn search_card_market(
    query: String,
    ebay_region: Option<String>,
    ebay_host: Option<String>,
    ebay_sacat: Option<String>,
    client: tauri::State<'_, HttpClient>,
) -> Result<MarketSnapshot, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("Enter a card name or search.".into());
    }

    let cfg = EbaySiteConfig::resolve(ebay_region, ebay_host, ebay_sacat);

    let mut warnings: Vec<String> = vec![];

    let art = pokemon_tcg::fetch_card_art(&client.0, q).await;
    let (card_image_url, card_name) = match art {
        Some((img, name)) => (Some(img), Some(name)),
        None => {
            warnings.push(
                "Optional: no artwork from pokemontcg.io (rate limit, no match, or network).".into(),
            );
            (None, None)
        }
    };

    warnings.push(format!(
        "eBay site: {} (category filter _sacat={} on narrow attempt).",
        cfg.host, cfg.sacat_narrow
    ));

    let rows = ebay_scrape::scrape_ebay_sold(&client.0, q, &cfg).await?;
    let tiers = ebay_scrape::bucket_into_tiers(rows);

    warnings.push(
        "Scraped from eBay’s public sold search — not affiliated with eBay; HTML changes can break this. Tier buckets are keyword guesses from titles, not slab verification."
            .into(),
    );

    Ok(MarketSnapshot {
        query: q.to_string(),
        card_name,
        card_image_url,
        tiers,
        ebay_search_url: ebay_scrape::ebay_sold_search_url_for_snapshot(q, &cfg),
        warnings,
    })
}

#[tauri::command]
async fn history_search_vps(
    query: String,
    api_base: String,
    api_key: String,
    client: tauri::State<'_, HttpClient>,
) -> Result<HistorySearchSnapshot, String> {
    history_api::fetch_history_search(&client.0, api_base, api_key, query).await
}

#[tauri::command]
async fn history_item_vps(
    ebay_item_id: String,
    api_base: String,
    api_key: String,
    client: tauri::State<'_, HttpClient>,
) -> Result<HistoryItemDetail, String> {
    history_api::fetch_item_history(&client.0, api_base, api_key, ebay_item_id).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(HttpClient(
            Client::builder()
                .cookie_store(true)
                .use_rustls_tls()
                .build()
                .expect("reqwest client"),
        ))
        .invoke_handler(tauri::generate_handler![
            search_card_market,
            history_search_vps,
            history_item_vps,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
