# Pokémon Card Desktop

Tauri + React app for Pokémon card pricing: **PriceCharting** tiers and marketplace sold rows, **eBay active listings** (Browse API), optional **recorded eBay comps** from your self-hosted API.

## Setup & usage

See **[`../docs/SETUP.md`](../docs/SETUP.md)** for:

- Installing dependencies and configuring `.env`
- Running `npm run tauri dev` and building releases
- Using the purchase sheet, buy basket, and VPS history panel
- Deploying **`ebay-history-stack`** (Docker Compose or Coolify)

## Quick start

```bash
npm install
copy .env.example .env   # Windows — use cp on macOS/Linux
# Edit .env: PRICECHARTING_TOKEN, optionally EBAY_CLIENT_ID / EBAY_CLIENT_SECRET

npm run tauri dev
```

## IDE (optional)

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
