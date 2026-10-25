# Changelog

## 4.0.0 (2026-10-25)

One command set, no legacy duplicates.

- Removed `volume`, `related` and `competitor`. Use `labs overview` (volume, CPC, competition, difficulty, intent, trend in one $0.012 call), `labs suggestions` and `labs ranked`, which call the same endpoints with the same output rules as every other command.
- Fixed: missing search volume, CPC or competition printed as 0 in the removed commands. Missing data is now always an empty cell.
- Keyword-list commands return a row for every requested keyword; keywords with no data get an empty row instead of disappearing.
- Keyword and domain lists longer than the API limit (700 or 1000) are split into several calls and merged, instead of failing.
- `locations` and `languages` use the shared output (`--json`, `--fields`, `-n`) and the request cache; the separate keyword cache (`~/.cache/dataforseo-cli/cache.json`) is no longer used.
- `--set-credentials` accepts passwords that contain `=`.

## 3.0.0 (2026-10-25)

Full DataForSEO v3 coverage built for research agents.

- Typed commands for every API group: `serp`, `trends`, `keywords`, `labs`, `backlinks`, `onpage`, `content-analysis`, `domain-analytics`, `merchant`, `app-data`, `business-data`, `ai`, plus `balance`, `prices`, `session`, `config`.
- `api` reaches all 565 v3 endpoints (`--list`, `--describe`, `key=value` fields or `--body`).
- Output is curated columns as TSV (or trimmed JSON), never raw API JSON: envelope and noise fields stripped, text truncated, default row limits with a "more rows" hint. 64× smaller than the raw responses across 89 real calls.
- Cost estimate and `--max-cost` guard on every call, optional session cap, one cost line on stderr.
- Live by default, `--queue` with polling; queue-only endpoints poll automatically.
- Request cache by endpoint and body with a TTL per API group.
- `dfs` short alias; private cache file permissions.
- Supersedes 2.0.0 (a catalog-and-passthrough design published from uncommitted work; source on the `release/2.0.0` branch).

## 2.0.0 (2026-09-04)

Generated endpoint catalog with `endpoints`, `describe` and `api` commands and DataForSEO `.ai` responses. Published to npm only; source committed later on `release/2.0.0`.

## 1.1.0 (2026-10-25)

First version of the full-coverage work above (GitHub only).

## 1.0.0 to 1.0.6 (2026-02)

`volume`, `related`, `competitor`, `locations`, `languages`, `status`.
