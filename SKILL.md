---
name: dataforseo-cli
description: Compact, full-coverage DataForSEO v3 CLI for AI agents. Discover, describe, and call any pinned operation for SERP, keywords, competitors, backlinks, on-page SEO, business, content, merchant, app, domain, or AI research.
license: MIT
metadata:
  author: alexgusevski
  version: "2.0.0"
---

# DataForSEO CLI

Use `dfs` (`dataforseo-cli` is identical) for structured SEO research. It bundles an offline, reduced catalog of all 570 operations in a pinned official OpenAPI specification and permits relative-path passthrough for future endpoints.

## Operating loop

Never guess an operation ID or request shape:

```bash
# Offline; no credentials, API call, or charge
dfs endpoints <search terms> [--family FAMILY] [-X METHOD]
dfs describe <OPERATION_OR_PATH> [--all-fields]

# Online; can be billable
dfs api <OPERATION_OR_PATH> [request fields...]
```

With no terms, `dfs endpoints` lists families and counts. Search terms are AND-matched across operation, path, fields, family, and summary. `describe` prints required/conditional fields, a schema-filtered upstream example, `.ai` eligibility, and official docs; use `--all-fields` for optionals or `--json` for the full catalog entry. Disambiguate duplicate IDs with `-X` or a path.

For an uncatalogued new endpoint, pass a relative path and explicit method:

```bash
dfs api /v3/new_family/new_endpoint -X POST --data @request.json
```

Do not pass absolute URLs. The CLI does not retry requests; do not automatically repeat a potentially billable POST.

## Input rules

- `key=value` is a string, including numeric-looking values.
- `key:=JSON` preserves JSON type: `limit:=20`, `exact_match:=true`, `'keywords:=["a","b"]'`, `'filters:=[["field",">",10]]'`.
- Catalogued task bodies auto-wrap one object as `[object]`; pass a JSON array to batch tasks.
- `--data/-d` accepts inline JSON, `@file`, or `-` for explicit stdin. Do not mix it with positional body fields.
- A field matching `{name}` fills and URL-encodes that path parameter: `dfs api GoogleOrganicTaskGetAdvanced id=TASK_ID`.
- For GET/HEAD, remaining positional fields become query parameters. `-q/--query key=value` adds explicit query parameters and also accepts `key:=JSON`.

## Output rules

Generic `api` output defaults to compact one-line JSON.

```bash
dfs api GoogleKeywordSuggestionsLive 'keyword=seo tools' location_code:=2840 \
  --fields 'keyword,volume=keyword_info.search_volume,kd=keyword_properties.keyword_difficulty'
```

`--fields name,alias=dot.path` projects common `items` arrays and defaults to TSV. Use `--select dot.path` before projection. Formats: `-f json|jsonl|tsv|table`.

Eligible Live, Task GET, and location endpoints default to DataForSEO `.ai`. `.ai` is compact but lossy:

- Default: `.ai` when eligible; otherwise locally compact the routine envelope.
- `--no-ai`: standard endpoint, locally compacted result.
- `--full`: standard endpoint and complete response envelope.

Use `--full` when any omitted metadata could matter. Do not combine it with an explicit `.ai` path.

## Research recipes

These verified operation IDs are in the bundled catalog. The calls below can incur DataForSEO charges.

```bash
# Google SERP
dfs api GoogleOrganicLiveAdvanced 'keyword=best crm software' \
  location_code:=2840 language_code=en depth:=20 \
  --fields 'type,rank=rank_group,domain,url,title'

# Labs keyword expansion
dfs api GoogleKeywordSuggestionsLive 'keyword=technical seo' \
  location_code:=2840 language_code=en limit:=50 \
  --fields 'keyword,volume=keyword_info.search_volume,kd=keyword_properties.keyword_difficulty'

# Labs competitor rankings
dfs api GoogleRankedKeywordsLive target=example.com \
  location_code:=2840 language_code=en limit:=50 \
  --fields 'keyword=keyword_data.keyword,position=ranked_serp_element.serp_item.rank_group,url=ranked_serp_element.serp_item.url'

# Backlinks
dfs api SummaryLive target=example.com include_subdomains:=true
dfs api BacklinksLive target=example.com limit:=50 \
  --fields 'source=url_from,target=url_to,domain=domain_from,rank,dofollow'

# On-page
dfs api InstantPages url=https://example.com load_resources:=true enable_browser_rendering:=true
dfs api ContentParsingLive url=https://example.com markdown_view:=true
```

Prefer `--fields` when only a few columns are needed. Run `describe --all-fields` before adding fields copied from another endpoint.

## Async tasks

Live endpoints return immediately. Task POST creates work; status `20100` means **Task Created**, so preserve the returned `id` and later use the matching Task GET:

```bash
dfs api GoogleOrganicTaskPost 'keyword=seo tools' location_code:=2840 language_code=en
dfs api GoogleOrganicTaskGetAdvanced id=TASK_ID
```

Do not interpret `20100` as the final result.

## Credentials, shortcuts, and cache

```bash
export DATAFORSEO_LOGIN='login@example.com'
export DATAFORSEO_PASSWORD='password'
# Or raw base64(login:password), without a "Basic " prefix:
export DATAFORSEO_AUTH='BASE64_TOKEN'
dfs status
```

Environment credentials are preferred for agents and take precedence. Legacy stored credentials remain available via `dfs --set-credentials login=... password=...` or `base64=...`, but command-line secrets may be exposed in history/process listings. Stored credentials: `~/.config/dataforseo-cli/config.json`, user-only permissions.

Curated commands remain available:

```bash
dfs volume <keywords...>
dfs related <seed> [-n LIMIT]
dfs competitor <domain> [-n LIMIT]
dfs locations [search] [--limit N | --all]
dfs languages [search]
```

The first three default to TSV and use a private, atomic per-key cache under `~/.cache/dataforseo-cli/` for seven days; `dfs --print-cache` inspects it. `locations` and `languages` are authenticated API calls, not offline data; locations defaults to 50 matches unless `--all` is set. Generic `api` calls are not cached.

Catalog maintainers working from a source checkout can run `node scripts/generate-catalog.mjs --check` to verify the pinned generated file or omit `--check` to regenerate it. The compact npm tarball excludes generator-only sources and dependencies. Update `SOURCE_COMMIT` deliberately before adopting a newer official schema.
