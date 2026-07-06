# EDGAR Part Number Hunter

A GitHub Pages research tool for searching SEC EDGAR full text filings for part numbers, NSNs, contract numbers, CAGE codes, program terms, and defense logistics language.

## Architecture

```text
GitHub Pages UI
    ↓
Cloudflare Worker
    ↓
SEC EDGAR full text search
    ↓
Normalized filing matches
    ↓
GitHub Pages result cards
```

The Pages UI is connected to:

```text
https://edgar-part-number-hunter.spotterdeer.workers.dev
```

The browser no longer redirects to the SEC search page to execute a search. It calls the Worker `/search` endpoint and displays returned SEC filing matches directly.

## What it does

- Accepts multiple keywords or identifiers, one per line.
- Supports any keyword, all keywords, or exact phrase / identifier logic.
- Supports exclusion keywords, filing date ranges, filing form focus, and result limits.
- Searches SEC EDGAR through the Cloudflare Worker.
- Displays company, form, filing date, CIK, accession number, filename, and match context.
- Links directly to the matching SEC archive document and filing index.
- Filters and sorts results locally.
- Exports displayed results to CSV or JSON.
- Stores recent keywords only in browser local storage.

## Worker

Worker source is in `worker/src/index.js`.

The repository root `wrangler.jsonc` points Cloudflare Git deployments directly to that Worker entry point:

```text
worker/src/index.js
```

The repository also includes a root `package.json` with deterministic Wrangler commands:

```text
npm run deploy
npm run dev
npm run check
```

The Worker exposes:

```text
GET /health
GET /diagnostic
GET /search?q=launcher&startdt=1994-01-01&enddt=2026-07-06&size=50
```

`/diagnostic` compares the SEC full text search endpoint with a documented static SEC data endpoint. This distinguishes a general SEC connectivity failure from an EFTS specific refusal.

The Worker uses a declared SEC contact User Agent configured in `wrangler.jsonc`, caps result size at 100, caches identical successful searches for 60 seconds, and returns CORS enabled JSON for the Pages UI.

Cloudflare should deploy the Worker named `edgar-part-number-hunter` from the repository root using `npm run deploy` or `npx wrangler deploy`.

## GitHub Pages

The application lives in `docs/`. GitHub Pages is configured from `main` and `/docs`.

This project is independent and is not affiliated with or endorsed by the U.S. Securities and Exchange Commission.
