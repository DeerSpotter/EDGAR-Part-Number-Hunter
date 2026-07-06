# EDGAR Part Number Hunter

A GitHub Pages research tool for building SEC EDGAR full text searches for part numbers, NSNs, contract numbers, CAGE codes, program terms, and defense logistics language.

## What it does

- Accepts multiple keywords or identifiers, one per line.
- Supports any keyword, all keywords, or exact phrase / identifier logic.
- Supports exclusion keywords, filing date ranges, and filing form focus.
- Builds one combined SEC.gov full text search.
- Builds an individual SEC.gov search queue for every keyword.
- Copies generated search syntax for reuse.
- Stores recent keywords only in the browser's local storage.

## No API

The browser application does not call the SEC JSON or EDGAR data APIs. It only generates normal SEC EDGAR full text search URLs and opens those searches on `sec.gov` after a user action.

## GitHub Pages

The application lives in `docs/`. The repository root also contains an `index.html` redirect so the project URL reaches the search interface even when Pages is configured from the `main` branch root.

The Pages workflow can deploy `docs/` through GitHub Actions after changes are merged to `main`.

This project is independent and is not affiliated with or endorsed by the U.S. Securities and Exchange Commission.
