# eBay listing history stack (VPS)

Playwright crawler + PostgreSQL + read-only JSON API. Designed for slow, sustained ingestion (~1000 pages/day configurable) with concurrent reads from your desktop app.

**Full setup (desktop + server + Coolify)** is documented in [`../docs/SETUP.md`](../docs/SETUP.md).

## Prerequisites

- Docker + Docker Compose v2
- A VPS with enough disk for Postgres + Chromium (~2 GB RAM minimum recommended)

## Quick start

1. Copy this folder to your VPS (e.g. `scp -r ebay-history-stack user@vps:~/`).

2. Create `.env` from the example:

   ```bash
   cp .env.example .env
   ```

   Set `POSTGRES_PASSWORD` and `API_KEY` to strong values.

3. Start:

   ```bash
   docker compose up -d --build
   ```

4. Check logs:

   ```bash
   docker compose logs -f crawler
   docker compose logs -f api
   ```

5. Health:

   ```bash
   curl -s http://127.0.0.1:3001/health
   ```

6. Search (requires API key):

   ```bash
   curl -s -H "Authorization: Bearer YOUR_API_KEY" "http://127.0.0.1:3001/v1/search?q=pikachu"
   ```

## Security baseline

- Keep PostgreSQL internal-only (do not publish `5432` publicly).
- Expose only the API service and protect routes with `Authorization: Bearer API_KEY`.
- Use firewall rules so only intended API traffic reaches your VPS.

## Desktop app (Tauri)

In **pokemon-card-desktop**, you can now use two private VPS-backed panels:

- **Recorded eBay sales** (`/v1/search`, `/v1/item/:id/history`)
- **Scraped PriceCharting + compare** (`/v1/pc/search`, `/v1/compare`)

Set these in `pokemon-card-desktop/.env`:

```bash
PC_API_BASE=https://your-vps.example.com:3001
PC_API_KEY=YOUR_API_KEY
```

`PC_API_KEY` should match server `API_KEY`.

## Compliance

You are responsible for complying with eBay’s terms and applicable law. This stack rate-limits and can be disabled with `CRAWLER_ENABLED=false`.

## Crawler behaviour

- Parses sold SERPs using **`div.s-card[data-listingid]`** (current eBay layout) and **`li.s-item`** (classic layout), deduped by item id.
- **Empty SERP:** advances `_pgn` instead of resetting to page 0 (avoids spinning on the same URL). Wraps to page `0` after page `400`.
- Docker image sets **`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`** so the official Playwright image’s bundled Chromium is used (no duplicate browser download during `npm install`).
- Includes **`pc-crawler`** service for private PriceCharting HTML scraping into `pc_products` and `pc_price_snapshots`.

## Stop / reset

```bash
docker compose down
```

To wipe DB volume:

```bash
docker compose down -v
```
