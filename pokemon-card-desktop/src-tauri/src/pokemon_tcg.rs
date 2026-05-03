use reqwest::Client;
use serde_json::Value;

/// Free public API — card artwork only (no sold prices). Optional: fails softly if rate-limited.
pub async fn fetch_card_art(client: &Client, query: &str) -> Option<(String, String)> {
    let q = query.trim();
    if q.is_empty() {
        return None;
    }
    let q_param = format!("name:{}", q);
    let enc = urlencoding::encode(&q_param);
    let url = format!("https://api.pokemontcg.io/v2/cards?q={}&pageSize=1", enc);
    let res = match client
        .get(&url)
        .header(
            "User-Agent",
            "PokemonCardDesktop/0.1 (personal research; +https://github.com/)",
        )
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return None,
    };
    if !res.status().is_success() {
        return None;
    }
    let body: Value = res.json().await.ok()?;
    let card = body["data"].as_array()?.first()?;
    let name = card["name"].as_str()?.to_string();
    let img = card["images"]["large"]
        .as_str()
        .or_else(|| card["images"]["small"].as_str())?
        .to_string();
    Some((img, name))
}
