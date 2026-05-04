import type { Page } from "playwright";

function r(a: number, b: number): number {
  return a + Math.floor(Math.random() * (b - a + 1));
}

function z(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Small extra hardening on top of playwright-extra stealth (runs in page context). */
export async function addExtraInitScript(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    } catch {
      /* ignore */
    }
  });
}

/** Curved / multi-step pointer path (less linear than a single move). */
export async function humanPointerWander(page: Page): Promise<void> {
  const v = page.viewportSize();
  const w = v?.width ?? 1280;
  const h = v?.height ?? 800;
  const targetX = r(100, w - 60);
  const targetY = r(100, h - 60);
  const startX = r(0, w);
  const startY = r(0, Math.min(120, h));
  const midX = r(40, w - 40);
  const midY = r(40, h - 40);
  await page.mouse.move(startX, startY, { steps: 1 });
  await z(r(40, 120));
  await page.mouse.move(midX, midY, { steps: r(18, 32) });
  await z(r(80, 400));
  await page.mouse.move(targetX, targetY, { steps: r(20, 45) });
  await z(r(120, 500));
}

/** Scroll + pause patterns (scanning a results page). */
export async function humanScrollResults(page: Page): Promise<void> {
  const v = page.viewportSize();
  const w = v?.width ?? 1280;
  const h = v?.height ?? 800;
  const passes = r(3, 7);
  for (let i = 0; i < passes; i++) {
    if (r(0, 5) === 0) {
      await humanPointerWander(page);
    }
    const dy = r(120, 480);
    await page.mouse.wheel(0, dy);
    await z(r(250, 1200));
    if (r(0, 3) === 0) {
      await page.mouse.move(r(40, w - 40), r(60, h - 60), { steps: r(8, 20) });
      await z(r(100, 400));
    }
  }
  await z(r(400, 2000));
}

/** Short home-page interaction (after goto home). */
export async function humanSkimHome(page: Page): Promise<void> {
  await humanPointerWander(page);
  await z(r(500, 2000));
  await page.mouse.wheel(0, r(100, 300));
  await z(r(400, 1500));
}

/** Hovers a few result cards (if present) like a user scanning titles. */
export async function humanHoverSomeCards(page: Page): Promise<void> {
  const n = r(1, 3);
  for (let i = 0; i < n; i++) {
    const loc = page.locator("div.s-card[data-listingid]").nth(i);
    const vis = await loc.isVisible().catch(() => false);
    if (!vis) break;
    await loc.hover({ timeout: 8000 }).catch(() => {});
    await z(r(400, 1800));
  }
}

/** Pause that mimics reading the first screen of results. */
export async function humanReadingPause(): Promise<void> {
  await z(r(1500, 6500));
}
