# dataforseo-cli

CLI wrapper for the [DataForSEO API](https://dataforseo.com). Outputs keyword data as TSV by default (fewer tokens than JSON), with `--json` and `--table` alternatives.

Supports keyword volume lookups, related keyword discovery, and competitor keyword analysis.

## Install

```bash
npm install -g dataforseo-cli
```

## Setup

```bash
# Login + password
dataforseo-cli --set-credentials login=YOUR_LOGIN password=YOUR_PASSWORD

# Or base64 token (from DataForSEO email)
dataforseo-cli --set-credentials base64=YOUR_BASE64_TOKEN
```

Credentials stored in `~/.config/dataforseo-cli/config.json`.

## Commands

### `volume`

Search volume, CPC, keyword difficulty (0–100), competition, and 12-month trend.

**API endpoints:** `keywords_data/google_ads/search_volume/live` + `dataforseo_labs/google/bulk_keyword_difficulty/live`

```bash
dataforseo-cli volume "seo tools" "keyword research"
dataforseo-cli volume "seo verktyg" --location 2752 --language sv
```

```
keyword	volume	cpc	difficulty	competition	trend
seo tools	12500	2.35	45	HIGH	14800,13900,12500,12100,11800,12000,12500,13000,12800,12500,12200,11900
```

`trend` is 12 monthly search volumes (newest first). `difficulty` is 0–100. `cpc` is in USD.

### `related`

Keyword suggestions from a seed keyword.

**API endpoint:** `dataforseo_labs/google/keyword_suggestions/live`

```bash
dataforseo-cli related "seo tools"
dataforseo-cli related "ai agents" -n 20
```

```
keyword	volume	cpc	competition	difficulty
best seo tools	8100	3.10	0.82	52
free seo tools	6600	1.85	0.65	38
```

### `competitor`

Keywords a domain ranks for.

**API endpoint:** `dataforseo_labs/google/ranked_keywords/live`

```bash
dataforseo-cli competitor ahrefs.com
dataforseo-cli competitor semrush.com -n 20 --json
```

```
keyword	position	volume	cpc	difficulty	url
backlink checker	1	33100	4.50	72	https://ahrefs.com/backlink-checker
```

### `locations`

Look up location codes for `--location`.

```bash
dataforseo-cli locations sweden
```

### `languages`

Look up language codes for `--language`.

```bash
dataforseo-cli languages swedish
```

## Options

**Filtering:**

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--location <code>` | `-l` | Location code | `2840` (US) |
| `--language <code>` | | Language code | `en` |
| `--limit <n>` | `-n` | Max results (`related`, `competitor`) | `50` |

**Output format:**

| Flag | Description |
|------|-------------|
| *(default)* | TSV — uses fewer tokens than JSON |
| `--json` | JSON array |
| `--table` / `--human` | Human-readable table |

## Caching

Results cached in `~/.config/dataforseo-cli/cache/` to avoid duplicate API calls.

```bash
dataforseo-cli --print-cache
```

## Author

**Alexander Gusev** ([@alexgusevski](https://github.com/alexgusevski))

## License

MIT
