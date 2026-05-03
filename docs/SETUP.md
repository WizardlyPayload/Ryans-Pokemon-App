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

Optional tuning: `GLOBAL_PAGES_PER_DAY`, `US_SHARE`, `UK_SHARE`, delays, `CRAWLER_ENABLED`, seed URLs (see `.env.example`).

### Run with Docker Compose (plain VPS)

```bash
docker compose up -d --build
```

Check:

```bash
curl -s http://127.0.0.1:3001/health
curl -s -H "Authorization: Bearer YOUR_API_KEY" "http://127.0.0.1:3001/v1/search?q=pikachu"
docker compose logs -f crawler
docker compose logs -f api
```

Put **HTTPS** in front (Caddy, nginx, or your host’s proxy) before exposing to the internet. Prefer **not** publishing Postgres (`5432`) publicly.

More detail: **`ebay-history-stack/README.md`**.

### Run on Coolify

1. Push **`ebay-history-stack`** (or the whole repo) to Git.
2. **New resource → Docker Compose** (or **Service Stack**, depending on version).
3. Select the repo and set the **base directory** to the folder that contains **`docker-compose.yml`** if it is not the repo root.
4. In **Environment variables**, set **`POSTGRES_PASSWORD`**, **`API_KEY`**, and any optional vars referenced in `docker-compose.yml`.
5. Assign a **domain** to the **`api`** service, routed to container port **3001**.
6. Deploy, then test `/health` and `/v1/search` over **HTTPS** with the Bearer token.

Use the Coolify **HTTPS URL** (origin only, no path) plus **`API_KEY`** in the desktop app.

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

For **Coolify-specific** routing or env injection, see [Coolify Docker Compose docs](https://coolify.io/docs/knowledge-base/docker/compose).
