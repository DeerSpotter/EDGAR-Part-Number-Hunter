# EDGAR Part Number Hunter

A GitHub Pages research tool for searching SEC EDGAR full-text filings for part numbers, NSNs, contract numbers, CAGE codes, program terms, and defense logistics language.

## What it does

- Searches multiple identifiers, one target per line.
- Supports exact phrase, filing date, and form filters.
- Ranks matching filings with defense and sustainment relevance signals.
- Links directly to the SEC filing index and exact SEC full-text search.
- Filters and sorts collected matches in the browser.
- Exports visible results to CSV or JSON.
- Stores recent search targets only in the browser's local storage.
- Runs searches sequentially with a deliberate request delay.

## GitHub Pages

The site lives in `docs/`. The Pages workflow deploys `docs/` after changes are merged to `main` or when the workflow is manually dispatched.

After the initial merge, make sure the repository's **Settings > Pages > Build and deployment > Source** is set to **GitHub Actions**.

## SEC access note

The SEC publishes EDGAR filing data for free and documents a current maximum request rate of 10 requests per second. The browser application searches sequentially and pauses between query requests. Because GitHub Pages is a static host, browser cross-origin restrictions or SEC access controls can block direct JSON retrieval in some environments. When that happens, the application provides a direct SEC.gov full-text search link for each target instead of hiding the failure.

This project is independent and is not affiliated with or endorsed by the U.S. Securities and Exchange Commission.
