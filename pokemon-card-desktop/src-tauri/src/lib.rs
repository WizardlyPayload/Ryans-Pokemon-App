mod ebay;
mod history_api;
mod pricecharting;
mod types;

use reqwest::Client;
use types::{CardLoadout, HistoryItemDetail, HistorySearchSnapshot, ProductSummary};

pub struct HttpClient(pub Client);

#[tauri::command]
async fn pc_search_products(
    query: String,
    client: tauri::State<'_, HttpClient>,
) -> Result<Vec<ProductSummary>, String> {
    let token = pricecharting::pc_token()?;
    pricecharting::search_products(&client.0, &token, &query).await
}

#[tauri::command]
async fn load_card(
    product_id: String,
    client: tauri::State<'_, HttpClient>,
) -> Result<CardLoadout, String> {
    let pc_token = pricecharting::pc_token()?;
    let product_json = pricecharting::fetch_product(&client.0, &pc_token, &product_id).await?;
    let product = pricecharting::product_details_from_json(&product_json, &product_id);

    let mut warnings: Vec<String> = vec![];

    if let Some(ref g) = product.genre {
        if !g.eq_ignore_ascii_case("Pokemon Card") {
            warnings.push(format!(
                "PriceCharting genre is \"{}\" — verify this is the Pokémon card you intended.",
                g
            ));
        }
    }

    let tiers = pricecharting::build_tiers(&client.0, &pc_token, &product_id, &product_json).await?;

    let ebay_active = match ebay::ebay_creds() {
        Ok((cid, secret)) => match ebay::application_token(&client.0, &cid, &secret).await {
            Ok(bearer) => {
                let q = format!(
                    "{} {}",
                    product.product_name,
                    product.console_name
                );
                match ebay::search_active_listings(&client.0, &bearer, &q.trim(), 15).await {
                    Ok(rows) => rows,
                    Err(e) => {
                        warnings.push(format!("eBay active listings skipped: {e}"));
                        vec![]
                    }
                }
            }
            Err(e) => {
                warnings.push(format!("eBay OAuth failed: {e}"));
                vec![]
            }
        },
        Err(_) => {
            warnings.push(
                "eBay credentials missing — add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to .env for active listings."
                    .to_string(),
            );
            vec![]
        }
    };

    Ok(CardLoadout {
        product,
        tiers,
        ebay_active,
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
    dotenvy::dotenv().ok();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(HttpClient(
            Client::builder()
                .use_rustls_tls()
                .build()
                .expect("reqwest client"),
        ))
        .invoke_handler(tauri::generate_handler![
            pc_search_products,
            load_card,
            history_search_vps,
            history_item_vps,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
