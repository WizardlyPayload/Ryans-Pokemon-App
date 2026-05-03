/// Heuristic buckets from listing title + subtitle (not legal grading — UI hint only).
pub fn classify_bucket(title: &str, subtitle: &str) -> &'static str {
    let t = format!("{} {}", title, subtitle).to_lowercase();
    if t.contains("psa 10") || t.contains("psa10") || t.contains("psa-10") {
        return "psa10";
    }
    if t.contains("psa 9") || t.contains("psa9") || t.contains("psa-9") {
        return "psa9";
    }
    if t.contains("psa 8") || t.contains("psa8") {
        return "psa8";
    }
    if t.contains("bgs 10") || t.contains("bgs10") || t.contains("beckett 10") {
        return "bgs10";
    }
    if t.contains("cgc 10") || t.contains("cgc10") {
        return "cgc10";
    }
    if t.contains("sgc 10") || t.contains("sgc10") {
        return "sgc10";
    }
    if t.contains("psa ") || t.contains("bgs ") || t.contains("cgc ") || t.contains("sgc ") || t.contains("graded") {
        return "other_graded";
    }
    if t.contains("ungraded")
        || t.contains("raw")
        || t.contains("near mint")
        || t.contains("nm ")
        || t.contains(" nm")
        || t.contains("lp ")
        || t.contains("lightly played")
        || t.contains("mp ")
        || t.contains("moderately")
        || t.contains("hp ")
        || t.contains("heavily")
    {
        return "raw_nm";
    }
    "unclassified"
}

pub fn tier_order_and_labels() -> Vec<(&'static str, &'static str)> {
    vec![
        ("psa10", "PSA 10 (title/heuristic)"),
        ("psa9", "PSA 9"),
        ("psa8", "PSA 8"),
        ("bgs10", "BGS 10"),
        ("cgc10", "CGC 10"),
        ("sgc10", "SGC 10"),
        ("other_graded", "Other graded"),
        ("raw_nm", "Raw / played (keywords)"),
        ("unclassified", "Unclassified"),
    ]
}
