# dataforseo-cli

Compact, full-coverage DataForSEO v3 CLI for AI agents. Discover an endpoint offline, inspect only the request shape you need, then call it with token-efficient input and output.

Version 2 bundles a generated catalog of all **570 HTTP operations** in the [pinned official OpenAPI specification](https://github.com/dataforseo/OpenApiDocumentation/blob/77ad3da06857d17770535696606bcf435eea965b/openapi_specification.yaml). The catalog keeps method, path, operation ID, request fields, schema-filtered examples, `.ai` support, and a documentation link; it omits bulky response schemas. A permissive relative-path mode can call endpoints added after the pinned specification.

Both binary names are equivalent:

```bash
dataforseo-cli --version
dfs --version
```

## Install and authenticate

```bash
npm install -g dataforseo-cli
export DATAFORSEO_LOGIN='login@example.com'
export DATAFORSEO_PASSWORD='password'
# Alternative: raw base64(login:password), without the "Basic " prefix
export DATAFORSEO_AUTH='BASE64_TOKEN'
dfs status
```

Environment values take precedence and are recommended for agents. For backward compatibility, credentials can be stored with `dfs --set-credentials login=... password=...` or `base64=...`; command-line secrets may be visible in shell history and process listings. Stored credentials live at `~/.config/dataforseo-cli/config.json` with user-only permissions. `status` is local, makes no API request, and never prints the password.

## The three-step agent workflow

```bash
# 1. Search the catalog (offline and free)
dfs endpoints keyword suggestions --family dataforseo_labs

# 2. Inspect required fields and an official example (offline and free)
dfs describe GoogleKeywordSuggestionsLive

# 3. Call it (contacts DataForSEO and may be billable)
dfs api GoogleKeywordSuggestionsLive 'keyword=seo tools' \
  location_code:=2840 language_code=en limit:=25
```

`endpoints` searches operation IDs, paths, request fields, families, and summaries with AND semantics. With no terms it lists API families and operation counts. Useful filters are `--family`, `-X/--method`, `--ai`, `--limit`, and `--all`.

`describe` accepts an operation ID, path template, or concrete path. It shows required and conditional fields plus a schema-filtered upstream example by default; add `--all-fields` for optional fields or `--json` for the complete compact entry. If an operation ID is ambiguous, use `-X METHOD` or the path.

`api` (alias: `call`) accepts an operation ID or a relative path. Catalogued operations infer their HTTP method and task-array shape:

```bash
dfs api GoogleOrganicLiveAdvanced 'keyword=agentic seo' location_code:=2840
dfs api /v3/serp/google/organic/live/advanced -X POST \
  --data '[{"keyword":"agentic seo","location_code":2840}]'

# Future endpoint not yet in the catalog: explicit method is recommended;
# --data remains the exact JSON body because no catalog shape is assumed
dfs api /v3/new_family/new_endpoint -X POST --data @request.json
```

Use relative paths for passthrough; the transport never sends credentials outside `api.dataforseo.com`.

## Compact request input

Positional fields are optimized for shell-based agents:

```bash
# key=value is always a string
dfs api GoogleOrganicLiveAdvanced 'keyword=seo tools' language_code=en

# key:=JSON preserves JSON types
dfs api GoogleOrganicLiveAdvanced 'keyword=seo tools' \
  location_code:=2840 depth:=20 calculate_rectangles:=false

dfs api GoogleAdsSearchVolumeLive \
  'keywords:=["seo tools","keyword research"]' location_code:=2840
```

Use `:=` for numbers, booleans, `null`, arrays, and objects. Use `=` for strings. For catalogued task endpoints, one object is automatically wrapped in DataForSEO's task array; pass an array when submitting a batch.

For larger or generated bodies, `--data/-d` accepts inline JSON, `@file`, or explicit stdin:

```bash
dfs api GoogleOrganicLiveAdvanced --data @serp-request.json
printf '%s' '[{"keyword":"seo tools","location_code":2840}]' \
  | dfs api GoogleOrganicLiveAdvanced --data -
```

Do not combine positional body fields with `--data`.

Path parameters can be supplied as normal fields. They are URL-encoded and removed from the remaining body or query:

```bash
dfs api GoogleOrganicTaskGetAdvanced id=TASK_ID
dfs api '/v3/serp/google/organic/task_get/advanced/{id}' id=TASK_ID
```

For GET/HEAD, unused positional fields become query parameters. Use repeatable `-q/--query key=value` for explicit URL query parameters; typed `key:=JSON` values are also accepted. For non-GET requests, positional fields form the body and `-q` remains the query.

## Agent-sized output

Generic `api` output defaults to one-line compact JSON. Use projections to keep only what the next step needs:

```bash
dfs api GoogleKeywordSuggestionsLive 'keyword=seo tools' location_code:=2840 limit:=50 \
  --fields 'keyword,volume=keyword_info.search_volume,kd=keyword_properties.keyword_difficulty'
```

`--fields name,alias=dot.path` automatically targets common DataForSEO `items` collections and defaults the format to TSV. Missing projected values become `null`. `--select dot.path` selects a subtree first. Override with `-f json`, `-f jsonl`, `-f tsv`, or `-f table`.

Eligible Live, Task GET, and location endpoints use DataForSEO's `.ai` suffix automatically. That server-side format is intentionally compact and **lossy**. Choose deliberately:

| Mode | Behavior |
|---|---|
| default | Use `.ai` when eligible; otherwise remove routine envelope bookkeeping locally |
| `--no-ai` | Use the standard endpoint, then locally compact successful task/result envelopes |
| `--full` | Disable `.ai` and preserve the complete standard response envelope |

Use `--full` whenever exact response fidelity or envelope metadata matters. An explicit `.ai` path cannot be combined with `--full`.

## SEO research examples

The operation IDs below are from the bundled catalog. These commands contact DataForSEO and may incur account charges.

### SERP research

```bash
dfs api GoogleOrganicLiveAdvanced 'keyword=best crm software' \
  location_code:=2840 language_code=en depth:=20 \
  --fields 'type,rank=rank_group,domain,url,title'
```

### Keyword and competitor research (DataForSEO Labs)

```bash
dfs api GoogleKeywordSuggestionsLive 'keyword=technical seo' \
  location_code:=2840 language_code=en limit:=50 \
  --fields 'keyword,volume=keyword_info.search_volume,kd=keyword_properties.keyword_difficulty,cpc=keyword_info.cpc'

dfs api GoogleRankedKeywordsLive target=example.com \
  location_code:=2840 language_code=en limit:=50 \
  --fields 'keyword=keyword_data.keyword,position=ranked_serp_element.serp_item.rank_group,url=ranked_serp_element.serp_item.url'
```

### Backlink research

```bash
dfs api SummaryLive target=example.com include_subdomains:=true

dfs api BacklinksLive target=example.com limit:=50 \
  --fields 'source=url_from,target=url_to,domain=domain_from,rank,dofollow'
```

### On-page research

```bash
dfs api InstantPages url=https://example.com \
  load_resources:=true enable_browser_rendering:=true

dfs api ContentParsingLive url=https://example.com markdown_view:=true
```

Run `dfs describe OPERATION --all-fields` before changing a recipe; DataForSEO field support varies by endpoint.

## Live versus Task POST / Task GET

Live operations return results in one request. Async Task POST operations create work and normally return compact JSON like:

```json
{"id":"...","status_code":20100,"status_message":"Task Created.","cost":0.01}
```

`20100` is a successful **creation** status, not the final result. Keep the `id`, wait until the task is ready, then call its corresponding Task GET operation:

```bash
dfs api GoogleOrganicTaskPost 'keyword=seo tools' \
  location_code:=2840 language_code=en
dfs api GoogleOrganicTaskGetAdvanced id=TASK_ID
```

The CLI performs one request and does not automatically retry billable POSTs.

## Curated shortcuts and cache

The v1 shortcuts remain for common research:

```bash
dfs volume 'seo tools' 'keyword research'          # volume, CPC, difficulty
dfs related 'seo tools' -n 30                      # keyword suggestions
dfs competitor example.com -n 30                  # ranking keywords
dfs locations sweden                               # first 50 Google Ads matches
dfs locations sweden --all                         # every matching location
dfs languages swedish                              # Google Ads language lookup
```

`volume`, `related`, and `competitor` default to TSV and support `--json` and `--table`. They cache results for seven days in a private, atomic per-key store under `~/.cache/dataforseo-cli/`; inspect it with `dfs --print-cache`. Generic `api` calls are not cached.

`locations` and `languages` are authenticated DataForSEO API calls. They are **not offline** and are not stored in the curated cache. `locations` defaults to 50 rows; use `--limit` or `--all`. Use `endpoints` and `describe` for offline discovery.

## Catalog maintenance

The generated catalog is deterministic and pinned so an agent's vocabulary does not drift unexpectedly. These are source-checkout maintenance commands; the compact npm tarball deliberately excludes the generator and development dependencies.

```bash
node scripts/generate-catalog.mjs --check  # compare with the pinned schema
node scripts/generate-catalog.mjs          # regenerate src/catalog.generated.ts
```

Both commands fetch the commit set as `SOURCE_COMMIT` in `scripts/generate-catalog.mjs` unless a local schema path is passed. To adopt a newer official schema, update that commit deliberately, regenerate, review, and run `npm test`. Do not hand-edit `src/catalog.generated.ts`.

## Agent skill

This repository includes [SKILL.md](./SKILL.md) for Agent Skills-compatible tools:

```bash
npx skills add alexgusevski/dataforseo-cli
```

MIT — Alexander Gusev ([@alexgusevski](https://github.com/alexgusevski))
