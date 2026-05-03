use crate::tier_classify::{classify_bucket, tier_order_and_labels};
use crate::types::{SoldScrapeRow, TierBucket};
use regex::Regex;
use reqwest::Client;
use reqwest::RequestBuilder;
use scraper::{Html, Selector};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::time::Duration;

const EBAY_UA_DESKTOP: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const EBAY_UA_MOBILE: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/// Per-request eBay site (host + narrow category id for first URL variant).
#[derive(Clone)]
pub struct EbaySiteConfig {
    pub host: String,
    pub sacat_narrow: String,
}

impl EbaySiteConfig {
    /// `ebay_region`: `Some("uk")` → UK sold search defaults; `Some("us")` or `None` → US Pokémon TCG category.
    /// Explicit `ebay_host` / `ebay_sacat` override env and presets when non-empty.
    pub fn resolve(
        ebay_region: Option<String>,
        ebay_host: Option<String>,
        ebay_sacat: Option<String>,
    ) -> Self {
        let region = ebay_region
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_lowercase());

        let mut host = ebay_host
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .or_else(|| std::env::var("EBAY_HOST").ok())
            .unwrap_or_else(|| {
                if matches!(region.as_deref(), Some("uk")) {
                    "www.ebay.co.uk".to_string()
                } else {
                    "www.ebay.com".to_string()
                }
            });

        host = host
            .trim_start_matches("https://")
            .trim_end_matches('/')
            .to_string();

        let sacat_narrow = ebay_sacat
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .or_else(|| std::env::var("EBAY_SACAT").ok())
            .unwrap_or_else(|| {
                if matches!(region.as_deref(), Some("uk")) {
                    "0".to_string()
                } else {
                    "31392".to_string()
                }
            });

        Self {
            host,
            sacat_narrow,
        }
    }

    fn origin(&self) -> String {
        format!("https://{}", self.host)
    }
}

fn ebay_sold_search_url(query: &str, cfg: &EbaySiteConfig) -> String {
    let nkw = urlencoding::encode(query);
    format!(
        "https://{}/sch/i.html?_nkw={}&_sacat={}&LH_Sold=1&LH_Complete=1&_ipg=60&rt=nc",
        cfg.host, nkw, cfg.sacat_narrow
    )
}

fn ebay_sold_search_url_wide(query: &str, cfg: &EbaySiteConfig) -> String {
    let nkw = urlencoding::encode(query);
    format!(
        "https://{}/sch/i.html?_nkw={}&LH_Sold=1&LH_Complete=1&_ipg=60&rt=nc",
        cfg.host, nkw
    )
}

fn ebay_get(client: &Client, url: &str, referer: Option<&str>, ua: &str, mobile: bool, cfg: &EbaySiteConfig) -> RequestBuilder {
    let accept_language = if cfg.host.contains("co.uk") {
        "en-GB,en;q=0.9"
    } else {
        "en-US,en;q=0.9"
    };

    let mut req = client.get(url).header("User-Agent", ua).header(
        "Accept",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    );
    req = req
        .header("Accept-Language", accept_language)
        .header("Accept-Encoding", "gzip, deflate, br")
        .header("Upgrade-Insecure-Requests", "1")
        .header("Sec-Fetch-Dest", "document")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", if referer.is_some() { "same-origin" } else { "none" })
        .header("Sec-Fetch-User", "?1")
        .header(
            "sec-ch-ua",
            r#""Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24""#,
        )
        .header("sec-ch-ua-mobile", if mobile { "?1" } else { "?0" })
        .header("sec-ch-ua-platform", if mobile { "\"iOS\"" } else { "\"Windows\"" });
    if let Some(r) = referer {
        req = req.header("Referer", r);
    }
    req
}

async fn prime_ebay_session(client: &Client, cfg: &EbaySiteConfig) {
    let origin = cfg.origin();
    let _ = ebay_get(
        client,
        &format!("{origin}/"),
        None,
        EBAY_UA_DESKTOP,
        false,
        cfg,
    )
    .send()
    .await;
    tokio::time::sleep(Duration::from_millis(650)).await;
}

fn looks_like_bot_wall(html: &str) -> bool {
    let h = html.to_lowercase();
    h.contains("pardon our interruption")
        || h.contains("verify you are human")
        || h.contains("are you a robot")
        || h.contains("chkrobot")
        || h.contains("challenge-container")
        || h.contains("geo-check")
        || (h.contains("access denied") && h.contains("edgesuite"))
}

async fn fetch_html(
    client: &Client,
    url: &str,
    ua: &str,
    mobile: bool,
    cfg: &EbaySiteConfig,
) -> Result<String, String> {
    let referer = format!("{}/", cfg.origin());
    ebay_get(client, url, Some(&referer), ua, mobile, cfg)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Body read failed: {e}"))
}

fn item_id_from_url(url: &str) -> Option<String> {
    let base = url.split('?').next()?;
    let rest = base.split("/itm/").nth(1)?;
    let id = rest.split('/').next()?.split('?').next()?;
    if id.chars().all(|c| c.is_ascii_digit()) && id.len() >= 10 {
        Some(id.to_string())
    } else {
        None
    }
}

fn normalize_ebay_item_url(href: &str, default_host: &str) -> Option<String> {
    let path = href.split('?').next()?.trim();
    if path.is_empty() {
        return None;
    }
    let full = if path.starts_with("https://") {
        path.to_string()
    } else if path.starts_with("//") {
        format!("https:{}", path)
    } else if path.starts_with('/') {
        format!("https://{}{}", default_host, path)
    } else if path.contains("itm/") {
        format!("https://{}/{}", default_host, path.trim_start_matches('/'))
    } else {
        return None;
    };
    Some(full.split('?').next().unwrap_or(&full).to_string())
}

#[derive(Deserialize)]
struct RenderProxyResponse {
    rows: Vec<RenderProxyRow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderProxyRow {
    title: String,
    price_display: String,
    detail: String,
    item_url: String,
    thumbnail_url: Option<String>,
}

async fn try_render_proxy(
    client: &Client,
    endpoint: &str,
    search_url: &str,
) -> Result<Vec<SoldScrapeRow>, String> {
    let body = serde_json::json!({ "searchUrl": search_url });
    let resp = client
        .post(endpoint)
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("Could not reach EBAY_RENDER_PROXY_URL: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Render proxy returned HTTP {}",
            resp.status().as_u16()
        ));
    }
    let parsed: RenderProxyResponse = resp
        .json()
        .await
        .map_err(|e| format!("Render proxy returned invalid JSON: {e}"))?;
    Ok(parsed
        .rows
        .into_iter()
        .map(|r| SoldScrapeRow {
            title: r.title,
            price_display: r.price_display,
            detail: r.detail,
            item_url: r.item_url,
            thumbnail_url: r.thumbnail_url,
        })
        .collect())
}

fn parse_ebay_items(html: &str, host: &str) -> Vec<SoldScrapeRow> {
    let document = Html::parse_document(html);
    let item_sel = Selector::parse("li.s-item, div.s-item").expect("selector");
    let title_sel = Selector::parse(".s-item__title").expect("selector");
    let price_sel = Selector::parse(".s-item__price").expect("selector");
    let link_sel = Selector::parse(r#"a[href*="/itm/"]"#).expect("selector");
    let img_sel = Selector::parse("img").expect("selector");
    let cap_sel = Selector::parse(".s-item__caption").expect("selector");

    let mut rows = Vec::new();

    for li in document.select(&item_sel) {
        let link_el = li.select(&link_sel).next();
        let Some(link_el) = link_el else {
            continue;
        };

        let href = link_el.value().attr("href").unwrap_or("");
        let Some(item_url) = normalize_ebay_item_url(href, host) else {
            continue;
        };

        let title = li
            .select(&title_sel)
            .next()
            .map(|n| n.text().collect::<String>().trim().to_string())
            .filter(|s| !s.is_empty() && !s.to_lowercase().starts_with("shop on ebay"))
            .or_else(|| {
                let t = link_el.text().collect::<String>().trim().to_string();
                if t.len() > 5 && !t.to_lowercase().starts_with("shop on ebay") {
                    Some(t)
                } else {
                    None
                }
            });

        let Some(title) = title else {
            continue;
        };

        let price = li
            .select(&price_sel)
            .next()
            .map(|n| n.text().collect::<String>().trim().to_string())
            .unwrap_or_else(|| "—".into());

        let detail = li
            .select(&cap_sel)
            .next()
            .map(|n| n.text().collect::<String>().trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Sold listing".into());

        let thumb = li
            .select(&img_sel)
            .next()
            .and_then(|img| {
                img.value()
                    .attr("src")
                    .or_else(|| img.value().attr("data-src"))
            })
            .filter(|s| s.starts_with("http"))
            .map(String::from);

        rows.push(SoldScrapeRow {
            title,
            price_display: price,
            detail,
            item_url,
            thumbnail_url: thumb,
        });

        if rows.len() >= 60 {
            break;
        }
    }

    rows
}

fn parse_s_card_items(html: &str, host: &str) -> Vec<SoldScrapeRow> {
    let document = Html::parse_document(html);
    let card_sel = Selector::parse(r#"div.s-card[data-listingid]"#).expect("selector");
    let link_sel = Selector::parse(r#"a.s-card__link[href*="/itm/"]"#).expect("selector");
    let price_sel = Selector::parse(".s-card__price").expect("selector");
    let cap_sel = Selector::parse(".s-card__caption").expect("selector");
    let img_sel = Selector::parse("img.s-card__image").expect("selector");

    let mut rows = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for card in document.select(&card_sel) {
        let mut item_url: Option<String> = None;
        let mut title_text: Option<String> = None;

        for a in card.select(&link_sel) {
            let href = a.value().attr("href").unwrap_or("");
            if let Some(u) = normalize_ebay_item_url(href, host) {
                if item_url.is_none() {
                    item_url = Some(u);
                }
                let is_image_link = a.value().classes().any(|c| c == "image-treatment");
                let t = a.text().collect::<String>().trim().to_string();
                if !is_image_link && t.len() > 5 && !t.to_lowercase().starts_with("shop on ebay") {
                    title_text = Some(t);
                }
            }
        }

        let title = title_text.or_else(|| {
            card.select(&img_sel).next().and_then(|img| {
                img.value()
                    .attr("alt")
                    .map(|s| s.trim().to_string())
                    .filter(|s| s.len() > 5 && !s.to_lowercase().starts_with("shop on ebay"))
            })
        });

        let Some(title) = title else {
            continue;
        };
        let Some(item_url) = item_url else {
            continue;
        };

        if let Some(id) = item_id_from_url(&item_url) {
            if !seen.insert(id) {
                continue;
            }
        }

        let price = card
            .select(&price_sel)
            .next()
            .map(|n| n.text().collect::<String>().trim().to_string())
            .unwrap_or_else(|| "—".into());

        let detail = card
            .select(&cap_sel)
            .next()
            .map(|n| n.text().collect::<String>().trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Sold listing".into());

        let thumb = card
            .select(&img_sel)
            .next()
            .and_then(|img| img.value().attr("src").or_else(|| img.value().attr("data-src")))
            .filter(|s| s.starts_with("http"))
            .map(String::from);

        rows.push(SoldScrapeRow {
            title,
            price_display: price,
            detail,
            item_url,
            thumbnail_url: thumb,
        });

        if rows.len() >= 60 {
            break;
        }
    }

    rows
}

fn parse_loose_itm_links(html_dom: &str, html_raw: &str, host: &str) -> Vec<SoldScrapeRow> {
    let document = Html::parse_document(html_dom);
    let a_sel = Selector::parse(r#"a[href*="/itm/"]"#).expect("selector");
    let price_re = Regex::new(r#"(?:£|\$)[\d,]+\.\d{2}"#).expect("regex");
    let mut seen: HashSet<String> = HashSet::new();
    let mut rows = Vec::new();

    for a in document.select(&a_sel) {
        let href_attr = a.value().attr("href").unwrap_or("");
        if href_attr.is_empty() {
            continue;
        }
        let mut clean = href_attr.split('?').next().unwrap_or(href_attr).to_string();
        if clean.starts_with("//") {
            clean = format!("https:{}", clean);
        } else if clean.starts_with('/') {
            clean = format!("https://{}{}", host, clean);
        }
        let Some(id) = item_id_from_url(&clean) else {
            continue;
        };
        if !seen.insert(id) {
            continue;
        }

        let title = a
            .text()
            .collect::<String>()
            .trim()
            .to_string();
        if title.len() < 5 || title.to_lowercase().starts_with("shop on ebay") {
            continue;
        }

        let price_display = href_attr
            .split('&')
            .next()
            .and_then(|h| html_raw.find(h))
            .and_then(|pos| {
                let slice = &html_raw[pos..html_raw.len().min(pos + 3500)];
                price_re
                    .find(slice)
                    .map(|m| m.as_str().to_string())
            })
            .unwrap_or_else(|| "—".into());

        let detail = "Sold listing (fallback parse)".into();

        rows.push(SoldScrapeRow {
            title,
            price_display,
            detail,
            item_url: clean,
            thumbnail_url: None,
        });

        if rows.len() >= 60 {
            break;
        }
    }

    rows
}

fn parse_rows_from_html(html: &str, host: &str) -> Vec<SoldScrapeRow> {
    let mut rows = parse_ebay_items(html, host);
    if rows.is_empty() {
        rows = parse_s_card_items(html, host);
    }
    if rows.is_empty() {
        rows = parse_loose_itm_links(html, html, host);
    }
    rows
}

pub async fn scrape_ebay_sold(
    client: &Client,
    query: &str,
    cfg: &EbaySiteConfig,
) -> Result<Vec<SoldScrapeRow>, String> {
    prime_ebay_session(client, cfg).await;

    let attempts = [
        (ebay_sold_search_url(query, cfg), EBAY_UA_DESKTOP, false),
        (ebay_sold_search_url_wide(query, cfg), EBAY_UA_DESKTOP, false),
        (ebay_sold_search_url(query, cfg), EBAY_UA_MOBILE, true),
        (ebay_sold_search_url_wide(query, cfg), EBAY_UA_MOBILE, true),
    ];

    let host = cfg.host.as_str();

    for (i, (url, ua, mobile)) in attempts.into_iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(Duration::from_millis(700)).await;
        }
        let html = fetch_html(client, &url, ua, mobile, cfg).await?;
        if looks_like_bot_wall(&html) {
            if i == 0 {
                return Err(
                    "eBay or Akamai blocked this request (bot-check, \"Access Denied\", or similar). Plain HTTP from some networks/VPNs/datacenters never receives real listing HTML. Use the in-app eBay link on your normal home connection, or run a headless browser on a VPS with a clean/residential route and slow, respectful rate limits."
                        .into(),
                );
            }
            continue;
        }
        let rows = parse_rows_from_html(&html, host);
        if !rows.is_empty() {
            return Ok(rows);
        }
    }

    if let Ok(endpoint) = std::env::var("EBAY_RENDER_PROXY_URL") {
        let endpoint = endpoint.trim();
        if !endpoint.is_empty() {
            let search_url = ebay_sold_search_url_wide(query, cfg);
            match try_render_proxy(client, endpoint, &search_url).await {
                Ok(rows) if !rows.is_empty() => return Ok(rows),
                Ok(_) => {}
                Err(e) => {
                    return Err(format!(
                        "{e} Set EBAY_RENDER_PROXY_URL to a running Playwright service (see scripts/ebay-sold-proxy.mjs), or unset it to hide this error."
                    ));
                }
            }
        }
    }

    Err(format!(
        "No sold listings in the fetched HTML for https://{}/. In the app, set **eBay region** to United Kingdom (uses sold search + all categories). If it still fails, eBay likely returned a JS-only shell to this client — open the in-app eBay link or set EBAY_RENDER_PROXY_URL to a Playwright render service.",
        cfg.host
    ))
}

/// Build the same sold-search URL shown in the UI (ties to current region config).
pub fn ebay_sold_search_url_for_snapshot(query: &str, cfg: &EbaySiteConfig) -> String {
    ebay_sold_search_url(query, cfg)
}

pub fn bucket_into_tiers(mut rows: Vec<SoldScrapeRow>) -> Vec<TierBucket> {
    let mut map: HashMap<&'static str, Vec<SoldScrapeRow>> = HashMap::new();

    for row in rows.drain(..) {
        let key = classify_bucket(&row.title, &row.detail);
        map.entry(key).or_default().push(row);
    }

    for list in map.values_mut() {
        list.truncate(5);
    }

    tier_order_and_labels()
        .into_iter()
        .map(|(key, label)| {
            let sold = map.remove(key).unwrap_or_default();
            let note = if sold.is_empty() {
                Some("No sold rows matched this bucket on the first results page (keyword heuristic only).".into())
            } else {
                None
            };
            TierBucket {
                tier_key: key.to_string(),
                label: label.to_string(),
                sold,
                section_note: note,
            }
        })
        .collect()
}
