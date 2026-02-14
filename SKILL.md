# Skill: Keyword Research with dataforseo-cli

## What
CLI tool for keyword research using DataForSEO API. Outputs TSV by default (fewer tokens than JSON), with `--json` and `--table` alternatives.

## When to Use
- Before writing SEO articles — check volume and difficulty for target keywords
- Finding content opportunities — discover related keywords with good volume/low difficulty
- Competitive analysis — see what keywords competitors rank for
- Validating keyword ideas — check if a keyword has search demand

## Prerequisites
- `dataforseo-cli` installed globally: `npm install -g dataforseo-cli`
- API credentials configured: `dataforseo-cli --set-credentials login=YOUR_LOGIN password=YOUR_PASSWORD`
- Or with base64 token: `dataforseo-cli --set-credentials base64=YOUR_BASE64_TOKEN`

Credentials stored in `~/.config/dataforseo-cli/config.json`.

## Commands

### Check keyword metrics
```bash
dataforseo-cli volume "keyword1" "keyword2" "keyword3"
```
Returns TSV: `keyword	volume	cpc	difficulty	competition	trend`

`trend` is 12 monthly search volumes (newest first). `difficulty` is 0–100. `cpc` is in USD.

### Find related keywords from a seed
```bash
dataforseo-cli related "seed keyword" -n 30
```
Returns TSV: `keyword	volume	cpc	competition	difficulty`

### See what a competitor ranks for
```bash
dataforseo-cli competitor example.com -n 30
```
Returns TSV: `keyword	position	volume	cpc	difficulty	url`

### Swedish market (or other locations)
Add `--location 2752 --language sv` for Sweden. Use `dataforseo-cli locations <search>` and `dataforseo-cli languages <search>` to find codes.

## Output Formats

| Flag | Description |
|------|-------------|
| *(default)* | TSV — fewest tokens, best for LLM pipelines |
| `--json` | JSON array |
| `--table` / `--human` | Human-readable table |

## Workflow: SEO Article Research

1. **Start with seed keyword:** `dataforseo-cli volume "your topic"`
2. **Expand:** `dataforseo-cli related "your topic" -n 30`
3. **Filter:** Pick keywords with volume > 100, difficulty < 60
4. **Check competitors:** `dataforseo-cli competitor competitor-domain.com -n 20`
5. **Write article** targeting the best keyword cluster

## Tips
- Difficulty 0-30 = easy, 31-60 = medium, 61-100 = hard
- DataForSEO charges per API request, not per keyword — batch keywords in `volume` command
- Default location is USA (2840). Always set location for local SEO
- Results are cached in `~/.config/dataforseo-cli/cache/` to avoid duplicate API calls
- Use `dataforseo-cli --print-cache` to inspect cached results
