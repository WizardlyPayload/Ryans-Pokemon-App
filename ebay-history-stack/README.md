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

## HTTPS (recommended)

Put **Caddy** or **nginx** in front with TLS and proxy `/` to `127.0.0.1:3001`. Restrict exposure with a firewall if only you use it.

## Desktop app (Tauri)

In **pokemon-card-desktop**, set **History API base URL** (e.g. `https://your-domain/v1` or `http://vps-ip:3001/v1`) and **API key**, then use **Load history comps**. The Rust backend calls `GET /v1/search` on your API.

## Compliance

You are responsible for complying with eBay’s terms and applicable law. This stack rate-limits and can be disabled with `CRAWLER_ENABLED=false`.

## Crawler behaviour

- Parses sold SERPs using **`div.s-card[data-listingid]`** (current eBay layout) and **`li.s-item`** (classic layout), deduped by item id.
- **Empty SERP:** advances `_pgn` instead of resetting to page 0 (avoids spinning on the same URL). Wraps to page `0` after page `400`.
- Docker image sets **`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`** so the official Playwright image’s bundled Chromium is used (no duplicate browser download during `npm install`).

## Stop / reset

```bash
docker compose down
```

To wipe DB volume:

```bash
docker compose down -v
```
