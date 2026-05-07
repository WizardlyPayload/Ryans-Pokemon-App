# Setup & usage guide

**Use the copy on your C: drive as the project root in Cursor:**  
`C:\Users\Graham\Documents\Ryans Pokemon App`  

If your editor was pointed at a `Z:` (or other mapped) folder, use **File → Open Folder** and choose this path so installs and builds run on local NTFS (avoids permission issues with `node_modules`).

A **global Cursor rule** (`~/.cursor/rules/no-z-ryans-pokemon-app.mdc`) tells the agent to use this **C:** folder only, not `Z:\Ryans Pokemon App`. Chats are still tied to whichever folder you have open—open this path for new work so history and tools line up.

---

This repo has two parts:

| Part | Purpose |
|------|--------|
| **`pokemon-card-desktop/`** | Tauri desktop app — PriceCharting lookup, eBay active listings, optional connection to your hosted history API. |
| **`ebay-history-stack/`** | Optional server stack — Playwright crawler + PostgreSQL + read-only HTTP API (deploy on a VPS, including via **Coolify**). |

---

## 1. Desktop app (`pokemon-card-desktop`)

### Requirements

- **Node.js** (LTS recommended; matches `package.json` engines if specified)
- **Rust** (`rustup`) and OS build tools for Tauri ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))
- **Windows**: WebView2 is usually already installed on recent Windows

### Install

```bash
cd pokemon-card-desktop
npm install
```

Create secrets file from the example:

```bash
copy .env.example .env
```

On macOS/Linux use `cp .env.example .env`.

Edit **`.env`** in the same folder as `package.json`:

| Variable | Required | Description |
|----------|----------|-------------|
| `PRICECHARTING_TOKEN` | Yes (for search/load) | From [PriceCharting API / subscriptions](https://www.pricecharting.com/subscriptions). |
| `EBAY_CLIENT_ID` | Optional | eBay Developer keyset — **Browse API** (used for **active** listings only). |
| `EBAY_CLIENT_SECRET` | Optional | Same keyset as client ID. |

Without eBay credentials the app still runs; the **Active listings (eBay)** section may show a warning and stay empty.

### Run in development

```bash
npm run tauri dev
```

Use the **native Tauri window**, not only the Vite URL in a browser — Rust commands run inside Tauri.

### Build an installer / binary

```bash
npm run tauri build
```

Artifacts appear under `pokemon-card-desktop/src-tauri/target/release/` (platform-specific).

### Windows tip (mapped drives e.g. `Z:`)

If `npm install` fails with **EPERM** or **esbuild** cannot run, move or clone the project to a **local NTFS path** (e.g. under `C:\Users\…`) and run installs there. Network/mapped drives sometimes block executing binaries in `node_modules`.

---

## 2. Using the desktop UI

### Purchase sheet (top)

Fill in any combination of:

- **Card name**, **Set name**, **Card number**, **Variant / notes**
- **Grading company**, **Grade**, **Language**, **Sealed**

The line **Search string** updates live — these fields are joined into one query so searches stay **narrow**.

Click **Get card value**:

1. Sends that string to **PriceCharting** (product search).
2. If **one** product matches, card data loads automatically.
3. If **several** match, choose a row and click **Load selected card data**.

Then you’ll see PriceCharting tiers (with marketplace sold rows where available) and **active** eBay listings when credentials are set.

### Buy basket / inventory

After a card is loaded, **Add to buy basket** saves a row with a **reference value** from tiers (prefers the **loose** tier when present).

- Edit **Paid** (USD); **Profit / loss** updates when both paid and current value exist.
- Choose **Method** (cash / trade) if you use it for notes.
- **Remove** deletes a row. The basket is stored in **browser local storage** for this app.

### Recorded eBay comps (optional VPS)

Expand **Recorded eBay comps (VPS database)**.

1. **API base URL** — HTTPS origin from your deployment, e.g. `https://ebay-api.example.com`  
   Do **not** rely on appending `/v1` manually; the app calls `/v1/search` and `/v1/item/...` itself.
2. **API key** — same value as **`API_KEY`** on the server.

Click **Search recorded comps** — uses the **same composed search string** as the purchase sheet (titles stored by your crawler).

### Scraped PriceCharting + compare (VPS)

Use the **Scraped PriceCharting + compare** panel for data from your private VPS stack:

1. Ensure `PC_API_BASE` / `PC_API_KEY` exist in `pokemon-card-desktop/.env` (or enter them in the panel).
2. Ensure the VPS API URL is reachable from your device.
3. Search to hit:
   - `GET /v1/pc/search`
   - `GET /v1/compare`

These routes are served by your VPS API and protected by API key auth.

---

## 3. Listing history stack (`ebay-history-stack`)

Use this when you want your **own** crawled eBay listing observations and a **read-only JSON API** for the desktop app.

### Requirements

- **Docker** + **Docker Compose v2** on the server (Coolify provides this on the host it manages).

### Configure

Copy env template:

```bash
cd ebay-history-stack
cp .env.example .env
```

Set at minimum:

- **`POSTGRES_PASSWORD`** — strong database password  
- **`API_KEY`** — long random string; use the **same** value in the desktop app  

Optional tuning: `GLOBAL_PAGES_PER_DAY`, `US_SHARE`, `UK_SHARE`, delays, `CRAWLER_ENABLED`, `PC_CRAWLER_ENABLED`, `PC_SEARCH_QUERY`, and seed URLs (see `.env.example`).

### Run with Docker Compose (plain VPS)

```bash
docker compose up -d --build
```

Check:

```bash
curl -s http://127.0.0.1:3001/health
curl -s -H "Authorization: Bearer YOUR_API_KEY" "http://127.0.0.1:3001/v1/search?q=pikachu"
curl -s -H "Authorization: Bearer YOUR_API_KEY" "http://127.0.0.1:3001/v1/pc/search?q=pikachu"
docker compose logs -f crawler
docker compose logs -f pc-crawler
docker compose logs -f api
```

**Crawler logs (JSON lines):** look for `page_ok` (parsed count, `inserted`), `empty_page` (no listings parsed — layout or end of results), `page_error` (often `bot_wall` if eBay serves a challenge). The worker alternates **US / UK** up to the per-day caps in `crawl_budget_daily`.

**Local sanity check (optional):** start Docker Desktop, then from `ebay-history-stack` run `docker compose build crawler` and `docker compose up -d` to confirm images build.

Security baseline:

- Keep PostgreSQL private/internal only (do not expose `5432` publicly).
- Expose only the API port and protect calls with `API_KEY`.
- Use host/cloud firewall rules to restrict access as needed.

### Run on Coolify (what actually happens)

Coolify’s UI wording changes between versions, but the **idea is always the same**:

1. You give Coolify a **Git repo** that contains **`docker-compose.yml`** (our stack defines **`postgres`**, **`api`**, **`crawler`**, **`pc-crawler`**).
2. Coolify **builds and starts** those services on your server.
3. You fill in **environment variables** Coolify discovers from the compose file (`POSTGRES_PASSWORD`, `API_KEY`, etc.).
4. You attach a **domain** so the outside world can reach **only the `api` service** on **container port `3001`** (Postgres and the crawler stay internal).

You are **not** looking for a generic “Dockerfile app” — you want a deployment type that is explicitly **Docker Compose** / **from Compose file** / **repository + compose** (exact label depends on your Coolify version).

Official reference: [Coolify — Docker Compose](https://coolify.io/docs/knowledge-base/docker/compose).

#### 1. Git

Push code so that **`docker-compose.yml`** exists on the branch you deploy.  
If that file is **not** at the repo root, Coolify will ask for a **base directory** / **root path** — set it to the folder that **contains** `docker-compose.yml` (e.g. `ebay-history-stack`).

#### 2. Create the deployment in Coolify

Use whatever your sidebar shows that means **new deployment from Git using Docker Compose**, for example:

- **\+ New resource** → choose **Docker Compose**, **Compose**, or **Docker Compose (Git)**  
- or **Project** → **Add** → **Docker Compose**  
- or **Services** → **New** → compose-based option  

Then: **connect Git** → pick **repository + branch** → set **base directory** if needed → save.

If you only see **Dockerfile** / **Nixpacks** / **Static** and no compose option, you’re in the wrong flow — go back and pick **Docker Compose**.

#### 3. Environment variables

Open this resource’s **Environment variables** / **Configuration** (names vary). Coolify lists variables that appear in `docker-compose.yml` as `${…}`.

Set at least:

| Name | Purpose |
|------|--------|
| **`POSTGRES_PASSWORD`** | DB password (used by Postgres + `DATABASE_URL` for `api` and `crawler`). |
| **`API_KEY`** | Secret for `Authorization: Bearer …` from the desktop app. |
| **`PC_CRAWLER_ENABLED`** | Turn PriceCharting HTML scraper on/off. |
| **`PC_SEARCH_QUERY`** | Seed query for the PriceCharting scrape loop. |

Save. Optional: `GLOBAL_PAGES_PER_DAY`, `CRAWLER_ENABLED`, delays, etc. (see **`ebay-history-stack/.env.example`**).

#### 4. Domain → **only** the `api` service, port **3001**

Per [Coolify docs](https://coolify.io/docs/knowledge-base/docker/compose): after the compose file loads, Coolify shows **services**. Use the **Domains** (or equivalent) section for the **`api`** service.

- Our API listens on **port `3001` inside the container** (not 80).  
- In the domain UI, if Coolify asks for a **port** or shows `https://hostname:3000`-style hints, that **`:3001`** tells the proxy **which container port** to use; visitors still use normal **HTTPS** on 443.

You **do not** put a public domain on **`postgres`** or **`crawler`**. The crawler has **no HTTP port** — check **Logs** for the `crawler` service.

#### 5. Deploy

**Deploy** / **Redeploy** and wait (first build compiles **api** + **crawler** images; can take a while). Then:

```bash
curl -s https://YOUR_HOST/health
curl -s -H "Authorization: Bearer YOUR_API_KEY" "https://YOUR_HOST/v1/search?q=pikachu"
```

#### 6. Desktop app

**API base URL** = `https://YOUR_HOST` (no `/v1`). **API key** = **`API_KEY`**.

#### 7. Pause scraping only

Set **`CRAWLER_ENABLED=false`** in env → save → redeploy. API + DB keep running.

---

## 4. Compliance

You are responsible for complying with **eBay’s terms**, rate limits, and applicable law. The crawler supports conservative defaults and can be turned off with **`CRAWLER_ENABLED=false`**. Use collected data only in permitted ways.

---

## 5. Quick troubleshooting

| Issue | What to try |
|-------|----------------|
| Desktop: “credentials missing” for eBay | Fill `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` in `.env`, restart dev app. |
| Desktop: PriceCharting errors | Check token; watch rate limits / billing on PriceCharting. |
| Desktop: VPS history 401 | **`API_KEY`** in app must match server **`API_KEY`** exactly. |
| Desktop: VPS connection errors | Confirm URL is reachable (HTTPS), firewall allows traffic, API container is up. |
| Server: crawler idle / errors | `docker compose logs crawler`; set `CRAWLER_ENABLED=true`; check DB connectivity. |
| Server: `bot_wall` in logs | eBay is serving a block/challenge page; increase delays, reduce volume, or pause with `CRAWLER_ENABLED=false` until it clears. |
| Windows: Docker build fails | Start **Docker Desktop** (Linux engine); the daemon must be running for `docker compose build`. |
| Coolify: `open Dockerfile: no such file or directory` | Set **Build Pack** to **Docker Compose** (not Dockerfile). |
| Coolify: “Please load a Compose file” / empty compose editor | **Docker Compose Location** must match the file **in Git** exactly (including **`.yaml` vs `.yml`**). Use **`/docker-compose.yaml`** or **`/docker-compose.yml`** at repo root. Click **Show Deployable Compose** after Git pull. |
| Coolify: `no service selected` | Often caused by a compose file that only uses **`include:`** without top-level **`services:`** (Coolify’s merge step may not see services). This repo’s root **`docker-compose.yaml`** defines **`postgres`**, **`api`**, and **`crawler`** explicitly. Commit that file and redeploy. |

For **Coolify-specific** routing or env injection, see [Coolify Docker Compose docs](https://coolify.io/docs/knowledge-base/docker/compose).
