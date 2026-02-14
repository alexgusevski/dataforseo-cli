# dataforseo-cli

Lightweight CLI for DataForSEO keyword research, optimized for LLM/agent workflows.

## The Problem

The DataForSEO API returns massive, deeply-nested JSON responses full of metadata that AI agents don't need. A single keyword query can return 50+ fields per result when you only need 5-6. This bloat makes it unusable for AI agent workflows where token efficiency matters.

## The Solution

**dataforseo-cli** extracts only the essential data and outputs it in **TSV format by default** — perfect for LLM parsing and agent workflows.

**~93% smaller output** than raw DataForSEO API responses.

Default output is **tab-separated values (TSV)** — the most compact and LLM-friendly format. Switch to `--json` or `--table` when needed for human readability.

## Install

```bash
npm install -g dataforseo-cli
```

## Setup

Set your DataForSEO credentials:

```bash
dataforseo-cli --set-api-key login=YOUR_LOGIN password=YOUR_PASSWORD
```

Credentials are stored in `~/.config/dataforseo-cli/config.json`.

## Commands

### Search Volume

Get search volume and metrics for specific keywords:

```bash
dataforseo-cli volume "seo tools" "keyword research"
dataforseo-cli volume "seo tools" --table
dataforseo-cli volume "seo verktyg" --location 2752 --language sv
```

**Default TSV output:**
```
keyword	volume	cpc	difficulty	competition	trend
seo tools	12500	2.35	45	0.78	stable
```

**Returns:** keyword, volume, CPC, difficulty (0-100), competition, 12-month trend

### Related Keywords

Find related keyword suggestions:

```bash
dataforseo-cli related "seo tools"
dataforseo-cli related "seo tools" -n 20 --table
dataforseo-cli related "ai agents" --location 2840 --language en
```

**Returns:** keyword, volume, CPC, competition, difficulty

### Competitor Keywords

Discover what keywords a domain ranks for:

```bash
dataforseo-cli competitor ahrefs.com
dataforseo-cli competitor ahrefs.com -n 20 --table
dataforseo-cli competitor semrush.com --json
```

**Returns:** keyword, position, volume, CPC, difficulty, URL

### Locations

Search for location codes:

```bash
dataforseo-cli locations sweden
dataforseo-cli locations "united states"
dataforseo-cli locations uk
```

**Returns:** location code and name (for `--location` parameter)

### Languages

Search for language codes:

```bash
dataforseo-cli languages swedish
dataforseo-cli languages spanish
```

**Returns:** language code and name (for `--language` parameter)

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `-l, --location <code>` | Location code (use `locations` command) | 2840 (USA) |
| `--language <code>` | Language code (use `languages` command) | en |
| `-n, --limit <n>` | Max results (related/competitor commands) | 50 |
| `--json` | Output as JSON | TSV |
| `--table` | Output as human-readable table | TSV |

## Output Formats

**TSV (default)** — Tab-separated values, perfect for AI agents and scripts:
```
keyword	volume	cpc
seo tools	12500	2.35
```

**JSON** (`--json`) — Structured data:
```json
[{"keyword": "seo tools", "volume": 12500, "cpc": 2.35}]
```

**Table** (`--table`) — Human-readable:
```
┌─────────────┬────────┬──────┐
│ keyword     │ volume │ cpc  │
├─────────────┼────────┼──────┤
│ seo tools   │ 12500  │ 2.35 │
└─────────────┴────────┴──────┘
```

## Caching

Results are cached locally to minimize API calls and speed up repeated queries. Cache is stored in `~/.config/dataforseo-cli/cache/`.

To view cache contents:
```bash
dataforseo-cli --print-cache
```

## Why?

This tool was built for **AI agent workflows** where:
- Token efficiency matters
- LLMs need to parse structured data quickly
- You want keyword research without drowning in JSON metadata
- Compact TSV output is more valuable than verbose API responses

The DataForSEO API is powerful but wasn't designed for AI agents. This CLI bridges that gap.

## Author

**Alexander Gusev** ([@alexgusevski](https://github.com/alexgusevski))

## License

MIT
