use crate::types::{PcSoldOffer, ProductDetails, ProductSummary, TierView};
use reqwest::Client;
use serde_json::Value;
use std::time::Duration;
use url::Url;

const PC_BASE: &str = "https://www.pricecharting.com";

pub fn pc_token() -> Result<String, String> {
    std::env::var("PRICECHARTING_TOKEN").map_err(|_| {
        "Missing PRICECHARTING_TOKEN. Copy .env.example to .env and add your PriceCharting API token."
            .to_string()
    })
}

async fn throttle() {
    tokio::time::sleep(Duration::from_millis(1100)).await;
}

fn as_str(v: &Value) -> Option<String> {
    v.as_str().map(String::from)
}

fn json_id_string(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn as_i64_price(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

pub async fn search_products(client: &Client, token: &str, q: &str) -> Result<Vec<ProductSummary>, String> {
    let mut url = Url::parse(&format!("{}/api/products", PC_BASE)).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("t", token)
        .append_pair("q", q);
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    if body["status"].as_str() != Some("success") {
        return Err(body["error-message"].as_str().unwrap_or("PriceCharting error").to_string());
    }
    let Some(arr) = body["products"].as_array() else {
        return Ok(vec![]);
    };
    let mut out = Vec::new();
    for p in arr {
        let id = json_id_string(&p["id"]).ok_or_else(|| "product missing id".to_string())?;
        out.push(ProductSummary {
            id,
            product_name: as_str(&p["product-name"]).unwrap_or_default(),
            console_name: as_str(&p["console-name"]).unwrap_or_default(),
        });
    }
    Ok(out)
}

pub async fn fetch_product(client: &Client, token: &str, id: &str) -> Result<Value, String> {
    throttle().await;
    let mut url = Url::parse(&format!("{}/api/product", PC_BASE)).map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("t", token).append_pair("id", id);
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    if body["status"].as_str() != Some("success") {
        return Err(body["error-message"].as_str().unwrap_or("PriceCharting error").to_string());
    }
    Ok(body)
}

fn absolutize_pc_url(maybe: Option<String>) -> Option<String> {
    let s = maybe?;
    if s.starts_with("http") {
        Some(s)
    } else if s.starts_with('/') {
        Some(format!("{}{}", PC_BASE, s))
    } else if !s.is_empty() {
        Some(format!("{}/{}", PC_BASE, s.trim_start_matches('/')))
    } else {
        None
    }
}

pub fn product_details_from_json(body: &Value, id: &str) -> ProductDetails {
    let product_name = as_str(&body["product-name"]).unwrap_or_default();
    let console_name = as_str(&body["console-name"]).unwrap_or_default();
    let genre = as_str(&body["genre"]);
    let image_url = absolutize_pc_url(
        as_str(&body["image-url"])
            .or_else(|| as_str(&body["image"]))
            .or_else(|| as_str(&body["thumbnail-url"])),
    );
    let pricecharting_search_url = format!(
        "https://www.pricecharting.com/search-products?q={}",
        urlencoding::encode(product_name.as_str()),
    );
    ProductDetails {
        id: id.to_string(),
        product_name,
        console_name,
        genre,
        image_url,
        pricecharting_search_url,
    }
}

/// Price-field keys, UI labels, and marketplace `condition-id` for sold offers (when applicable).
pub fn card_tier_definitions() -> Vec<(&'static str, &'static str, &'static str, Option<i32>)> {
    vec![
        ("loose", "loose-price", "Ungraded (loose-price · Condition ID 1)", Some(1)),
        ("new", "new-price", "Grade 8 (new-price · Condition ID 2)", Some(2)),
        ("cib", "cib-price", "Grade 7 (cib-price · Condition ID 3)", Some(3)),
        ("graded", "graded-price", "Grade 9 (graded-price · Condition ID 5)", Some(5)),
        ("box_only", "box-only-price", "Grade 9.5 (box-only-price · Condition ID 6)", Some(6)),
        ("psa10", "manual-only-price", "PSA 10 (manual-only-price · Condition ID 7)", Some(7)),
        ("bgs10", "bgs-10-price", "BGS 10 (bgs-10-price · Condition ID 8)", Some(8)),
        (
            "cgc10",
            "condition-17-price",
            "CGC 10 (condition-17-price)",
            None,
        ),
        (
            "sgc10",
            "condition-18-price",
            "SGC 10 (condition-18-price)",
            None,
        ),
    ]
}

pub async fn fetch_sold_offers(
    client: &Client,
    token: &str,
    product_id: &str,
    condition_id: i32,
) -> Result<Vec<PcSoldOffer>, String> {
    throttle().await;
    let mut url = Url::parse(&format!("{}/api/offers", PC_BASE)).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("t", token)
        .append_pair("status", "sold")
        .append_pair("id", product_id)
        .append_pair("condition-id", &condition_id.to_string());
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    if body["status"].as_str() != Some("success") {
        return Err(body["error-message"].as_str().unwrap_or("offers error").to_string());
    }
    let Some(offers) = body["offers"].as_array() else {
        return Ok(vec![]);
    };
    let mut parsed: Vec<PcSoldOffer> = offers
        .iter()
        .filter_map(|o| {
            let offer_id = json_id_string(&o["offer-id"])?;
            let price = as_i64_price(&o["price"]).unwrap_or(0);
            let rel = as_str(&o["offer-url"]).unwrap_or_default();
            let offer_url = absolutize_pc_url(Some(rel)).unwrap_or_default();
            Some(PcSoldOffer {
                offer_id,
                price_cents: price,
                sale_time: as_str(&o["sale-time"]).filter(|s| !s.starts_with("0001-01")),
                condition_string: as_str(&o["condition-string"]),
                include_string: as_str(&o["include-string"]),
                offer_url,
            })
        })
        .collect();

    parsed.sort_by(|a, b| {
        let da = a.sale_time.as_deref().unwrap_or("");
        let db = b.sale_time.as_deref().unwrap_or("");
        let ord = db.cmp(da);
        if ord != std::cmp::Ordering::Equal {
            return ord;
        }
        b.price_cents.cmp(&a.price_cents)
    });
    parsed.truncate(5);
    Ok(parsed)
}

pub async fn build_tiers(
    client: &Client,
    token: &str,
    product_id: &str,
    product_json: &Value,
) -> Result<Vec<TierView>, String> {
    let defs = card_tier_definitions();
    let mut tiers = Vec::new();
    for (tier_key, price_field, label, cond) in defs {
        let price_cents = as_i64_price(&product_json[price_field]);
        let (sold, note) = match cond {
            Some(cid) => {
                let offers = fetch_sold_offers(client, token, product_id, cid).await?;
                let n = if offers.is_empty() {
                    Some(
                        "No recent sold marketplace listings in this condition bucket on PriceCharting."
                            .to_string(),
                    )
                } else {
                    None
                };
                (offers, n)
            }
            None => (
                vec![],
                Some(
                    "Sold comps by tier are tied to PriceCharting marketplace condition IDs (see docs). \
                     CGC/SGC columns are shown as reference prices only here."
                        .to_string(),
                ),
            ),
        };
        tiers.push(TierView {
            tier_key: tier_key.to_string(),
            label: label.to_string(),
            price_field: price_field.to_string(),
            price_cents,
            condition_id: cond,
            sold,
            sold_section_note: note,
        });
    }
    Ok(tiers)
}
