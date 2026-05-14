/** Extract grade rows from VPS snapshot `tiers` JSON (PriceCharting scrape). */
export function gradesFromTiersJson(tiers: unknown): Array<{ grade: string; priceDisplay: string }> {
  if (!tiers || typeof tiers !== "object") return [];
  const g = (tiers as { grades?: unknown }).grades;
  if (!Array.isArray(g)) return [];
  const out: Array<{ grade: string; priceDisplay: string }> = [];
  for (const row of g) {
    if (!row || typeof row !== "object") continue;
    const grade = String((row as { grade?: unknown }).grade ?? "").trim();
    const priceDisplay = String((row as { priceDisplay?: unknown }).priceDisplay ?? "").trim();
    if (!grade && !priceDisplay) continue;
    out.push({
      grade: grade || "—",
      priceDisplay: priceDisplay || "—",
    });
  }
  return out;
}
