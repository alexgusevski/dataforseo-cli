# dataforseo-cli

Agent-friendly CLI for the whole [DataForSEO](https://dataforseo.com) v3 API. Every command prints a few curated columns as TSV (or trimmed JSON), never the raw API response: envelopes, metadata, layout and tracking fields are stripped, long text is truncated and lists stop at a default limit. Across 89 real calls the output was 64× smaller than the raw responses. See [CHANGELOG.md](./CHANGELOG.md).

It covers Google SERPs (with AI Overviews and People Also Ask), Google Trends, Google Ads and Bing keyword data, DataForSEO Labs (keywords, competitors, traffic, Amazon keywords), Backlinks, OnPage, Content Analysis, Domain Analytics, Merchant (Amazon, Google Shopping), App Data (App Store, Google Play), Business Data (Trustpilot, Google reviews, Tripadvisor) and AI Optimization (LLM mentions, AI search volume, ChatGPT/Claude/Gemini/Perplexity answers). An `api` passthrough reaches any of the 565 v3 endpoints.

## Install

```bash
npm install -g dataforseo-cli          # published release; installs `dataforseo-cli` and the short alias `dfs`
# or from this repo:
npm install && npm run build && npm install -g .
```

## Setup

```bash
dataforseo-cli status                  # are credentials configured? (no API call)
dataforseo-cli --set-credentials login=YOUR_LOGIN password=YOUR_PASSWORD
dataforseo-cli --set-credentials base64=YOUR_BASE64_TOKEN
dataforseo-cli balance                 # balance and subscriptions (free call)
```

Credentials are stored in `~/.config/dataforseo-cli/config.json` (mode 600) and never printed.

## Common research jobs

| Job | Command |
|---|---|
| Search volume, CPC, difficulty, intent, trend | `dataforseo-cli labs overview "kw one" "kw two" -l 2752 --language sv` |
| More keywords around a topic | `dataforseo-cli labs suggestions "creatine" -n 50` (or `labs ideas`, `labs related`) |
| Google Trends | `dataforseo-cli trends google "creatine"` (time series, regions, related queries/topics) |
| SERP with AI Overview + People Also Ask | `dataforseo-cli serp organic "is creatine safe"` |
| Autocomplete | `dataforseo-cli serp autocomplete "creatine"` |
| Who ranks for a topic | `dataforseo-cli labs serp-competitors "kw one" "kw two"` |
| A competitor's size and traffic | `dataforseo-cli labs domain-overview thorne.com` |
| A competitor's keywords / top pages | `dataforseo-cli labs ranked thorne.com -n 50` / `labs pages thorne.com` |
| Competitor domains | `dataforseo-cli labs competitors thorne.com` |
| Keyword gap between two sites | `dataforseo-cli labs intersection a.com b.com --gap` |
| Amazon products for a keyword | `dataforseo-cli merchant amazon-products "creatine gummies"` |
| Amazon product details, BSR | `dataforseo-cli merchant amazon-product B002DYIZEO` |
| Amazon keyword volume | `dataforseo-cli labs amazon-volume "creatine gummies"` |
| Trustpilot reviews | `dataforseo-cli business trustpilot-reviews thorne.com --depth 40` |
| Google reviews of a place | `dataforseo-cli business google-reviews "Vasa Museum" -l 2752` |
| App reviews | `dataforseo-cli apps apple-reviews 389801252` / `apps google-reviews com.instagram.android` |
| Brand mentions in ChatGPT / AI Overviews | `dataforseo-cli ai mentions thorne.com` and `ai top-brands "creatine"` |
| What an LLM answers | `dataforseo-cli ai ask "best creatine brand?" --llm perplexity` |
| Backlinks overview | `dataforseo-cli backlinks summary thorne.com` |
| Any other endpoint | `dataforseo-cli api --list <word>`, then `dataforseo-cli api <path> --body '{...}'` |

## Output

- **stdout = data only.** TSV with a header row by default; `--json` gives the same trimmed columns as compact JSON; `--table` aligns columns for humans.
- **stderr = one status line**: `cost=$0.0022 rows=24 cached=no session=$0.0310`. Add `-q` to hide it.
- **Row limit.** List commands show a default number of rows (see the reference table below) and end with `# 130 more rows; raise --limit (now 20) to see them`. Use `-n/--limit <n>`. For most Labs, Backlinks, Content Analysis and LLM Mentions commands the limit is also sent to the API, so a smaller limit costs less.
- **Columns.** `--fields a,b,c` keeps only those columns. Columns empty in every row are dropped.
- **Text.** Snippets, reviews and answers are cut at ~100-250 characters with `…`; `--full-text` lifts the cut.
- **Several tables.** Some commands (`trends google`, `onpage crawl`) print sections headed `# time`, `# regions`, ...; with `--json` they return `{"time":[...], ...}`.
- **`--raw-file <path>`** writes the untouched API response to a file for debugging. It is not for agents: never read that file into context.

## Locations and languages

`-l/--location` takes a code (`2752`) or a full name (`"Stockholm,Stockholm County,Sweden"`); `--language` takes a code (`sv`, `en`, Amazon uses `en_US`) or a name (`Swedish`). Default: `2840` (US), `en`.

```bash
dataforseo-cli locations sweden                 # Google Ads locations (used by volume, keywords, labs)
dataforseo-cli locations stockholm --api serp   # SERP locations (cities, districts)
dataforseo-cli languages swedish --api labs
```

`--api` values: ads (default), serp, labs, trends, dfs_trends, bing, amazon, shopping, apple, google_play, business, tripadvisor, content, ai, llm_mentions, chatgpt. Lists are cached for 30 days.

## Money

Every call prints its real cost on stderr. Before a call the CLI estimates its cost from the account's own price list (`dataforseo-cli prices <filter>`) and refuses it if the estimate exceeds the cap:

- `--max-cost <usd>` per call (default: `max_cost` from config, else **$1**).
- `dataforseo-cli config session_cap 2` refuses calls once the session total would pass $2. `dataforseo-cli session` shows the running total (a session ends after 6 idle hours; `session --reset` starts a new one).
- `dataforseo-cli config max_cost 0.5` changes the per-call default.

Typical costs: SERP $0.002, Labs $0.012, Trends $0.001-0.011, Backlinks $0.024, Content Analysis $0.024, reviews/app/business queue tasks under $0.002. **Expensive**: Google Ads and Bing (`keywords *`) $0.09, LLM Mentions (`ai mentions`, `ai mention-metrics`, `ai top-*`) $0.10, `domain whois` $0.12, `apps *-listings` $0.10. Batch keywords into one call (`labs overview` takes up to 700, `labs difficulty` and `keywords volume` up to 1000). For volumes prefer `labs overview` ($0.012) over `keywords volume` (Google Ads, $0.09).

## Live vs queue

Live is the default where it exists. `--queue` posts a task and polls until it is ready (`--timeout <sec>`, default 600). The queue base price is lower (SERP $0.0006 vs $0.002, Google Ads $0.06 vs $0.09; see `dataforseo-cli prices serp`), but it is slower (30-90 s), and extras such as the AI Overview and People Also Ask loading that `serp organic` requests are billed on top: a queued `serp organic` cost about the same as live in testing. Use `--queue` for large batches through `api`. Some endpoints only exist as queue tasks (Google Shopping, app stores, Trustpilot, Google reviews, Tripadvisor); those commands poll automatically. On a timeout the error line prints the command to fetch the result later.

## Cache

Responses are cached by endpoint + normalised request body in `~/.cache/dataforseo-cli/requests/`, so repeating a command is free. TTL: SERPs and Merchant 12 h; Trends, LLM answers, reviews, app and business data 24 h; Content Analysis 3 days; Backlinks and LLM Mentions 7 days; keyword volumes, Labs and Domain Analytics 30 days; location lists 30 days; account data never. `--no-cache` forces a fresh call. `dataforseo-cli --print-cache` shows what is cached.

## Errors

Errors are one line on stderr with what to do, exit code 1. Examples:

- `API error 40204: Access denied... This account has no access to the backlinks API; activate it in the DataForSEO dashboard (Plans and Subscriptions).`
- `API error 40200: Payment Required. Out of balance; top up at app.dataforseo.com (check with: dataforseo-cli balance).`
- `API error 40501: Invalid Field: 'location_code'. Find a valid code: dataforseo-cli locations <name> --api labs`
- `Estimated cost $1.2000 exceeds --max-cost $1. Narrow the request (--limit, fewer keywords) or raise --max-cost.`
- `Network error (...)`: no network. Codex sandboxes need `network_access = true`.

## Flags on every typed command

`-l/--location`, `--language`, `-n/--limit`, `--fields`, `--full-text`, `--json`, `--table`, `-q`, `--no-cache`, `--queue`, `--live`, `--timeout <sec>`, `--max-cost <usd>`, `--raw-file <path>`, and `--param key=value` (repeatable) to send any extra API field, e.g. `--param device=mobile` or `--param 'filters=[["keyword_info.search_volume",">",1000]]'`. See an endpoint's fields with `dataforseo-cli api --describe <path>`.

## Command reference

Missing data prints as an empty cell, never 0. Commands that take a keyword list (`labs overview`, `labs difficulty`, `labs intent`, `labs history`, `labs amazon-volume`, `keywords volume`, `keywords bing-volume`, `ai volume`) return one row per keyword you asked for; a keyword with no data gets a row with only its name. Lists longer than the API allows (700 keywords for `labs overview` and `labs history`, 1000 elsewhere) are split into several calls automatically; each call is billed.

### Account and setup

| Command | What it returns | Columns |
|---|---|---|
| `locations [search] --api <api>` / `languages [search] --api <api>` | Location and language codes (free, cached 30 days) | code, name, country, type / name, code |
| `status`, `balance`, `prices [filter]`, `session [--reset]`, `config [key] [value]` | Credentials check, balance and subscriptions, price list, spend, settings | |
| `--print-cache` | Number and size of cached responses | |

### `serp`

| Command | What it returns | Rows | Cost/call | Columns |
|---|---|---|---|---|
| `serp organic <keyword>`<br>`--depth` `--device` `--types` | Google organic SERP with AI Overview (present + cited URLs), People Also Ask, featured snippet and other features. | 50 | $0.0022 | pos, type (ai_overview\|aio_ref\|organic\|featured_snippet\|paa\|related_searches\|<feature>), domain, title, url, snippet |
| `serp ai-mode <keyword>`<br>`--device` | Google AI Mode answer with cited sources. | 30 | $0.004 | type (answer\|source), title, url, text |
| `serp autocomplete <keyword>`<br>`--cursor` `--client` | Google autocomplete suggestions. | 30 | $0.002 | pos, suggestion |
| `serp news <keyword>`<br>`--depth` `--sort-by` | Google News results. | 20 | $0.002 | pos, date, source, domain, title, url, snippet |
| `serp images <keyword>`<br>`--depth` | Google Images results. | 20 | $0.002 | pos, title, source, page_url |
| `serp maps <keyword>`<br>`--depth` | Google Maps results (local businesses). | 20 | $0.002 | pos, title, category, rating, reviews, price, address, phone, domain, claimed |
| `serp local <keyword>`<br>`--depth` | Google Local Finder (local pack expanded). | 20 | $0.002 | pos, title, category, rating, reviews, address, phone, domain |
| `serp youtube <keyword>`<br>`--depth` | YouTube search results. | 20 | $0.002 | pos, title, channel, views, published, duration, url |
| `serp bing <keyword>`<br>`--depth` `--device` | Bing organic SERP. | 50 | $0.002 | pos, type, domain, title, url, snippet |

### `trends`

| Command | What it returns | Rows | Cost/call | Columns |
|---|---|---|---|---|
| `trends google <keywords...>`<br>`--time-range` `--type` `--view` `--weekly` | Google Trends explore: interest over time (monthly), regions, and for a single keyword related queries and topics (up to 5 keywords). | 25 | $0.011 | time: date, <keyword>...; regions: region, <keyword>...; queries: keyword, kind (top\|rising), query, value; topics: keyword, kind, topic, topic_type, value |
| `trends dfs <keywords...>`<br>`--time-range` `--type` `--weekly` | DataForSEO Trends explore: interest over time from DataForSEO's own clickstream (cheaper; up to 5 keywords). | 60 | $0.0012 | date, <keyword>... |
| `trends regions <keywords...>`<br>`--time-range` `--type` | DataForSEO Trends interest by subregion. | 30 | $0.0024 | region, <keyword>... |

### `keywords`

| Command | What it returns | Rows | Cost/call | Columns |
|---|---|---|---|---|
| `keywords volume <keywords...>` | Google Ads search volume, CPC, competition and 12-month trend for up to 1000 keywords (Google Ads API: $0.09 per call live, cheaper with --queue). | 100 | $0.09 | keyword, volume, cpc, competition, comp_index, bid_low, bid_high, trend (trend = 12 monthly volumes, newest first) |
| `keywords for-site <target>`<br>`--page` | Keyword ideas Google Ads associates with a domain or URL (Google Ads API: $0.09 per call live, cheaper with --queue). | 50 | $0.09 | keyword, volume, cpc, competition, comp_index, bid_low, bid_high, trend |
| `keywords for-keywords <keywords...>` | Google Ads keyword ideas for up to 20 seed keywords (Google Ads API: $0.09 per call live, cheaper with --queue). | 50 | $0.09 | keyword, volume, cpc, competition, comp_index, bid_low, bid_high, trend |
| `keywords ad-traffic <keywords...>`<br>`--bid` `--match` | Google Ads traffic forecast (impressions, clicks, cost) for keywords at a max CPC bid (Google Ads API: $0.09 per call live, cheaper with --queue). | 100 | $0.09 | keyword, impressions, clicks, ctr, avg_cpc, cost |
| `keywords bing-volume <keywords...>` | Bing search volume, CPC and competition (Bing Ads API: $0.09 per call). | 100 | $0.09 | keyword, volume, cpc, competition, trend |

### `labs`

| Command | What it returns | Rows | Cost/call | Columns |
|---|---|---|---|---|
| `labs ideas <keywords...>`<br>`--order` | Keyword ideas from the product/service category of seed keywords. | 20 | $0.0126 | keyword, volume, cpc, competition, difficulty, intent |
| `labs suggestions <keyword>`<br>`--order` | Long-tail keywords that contain the seed keyword. | 20 | $0.0126 | keyword, volume, cpc, competition, difficulty, intent |
| `labs related <keyword>`<br>`--depth` `--order` | Related keywords from Google's 'searches related to' graph. | 20 | $0.0126 | keyword, volume, cpc, competition, difficulty, intent, depth |
| `labs overview <keywords...>` | Full keyword overview: volume, CPC, difficulty, intent, SERP features, 12-month trend. | 100 | $0.0122 | keyword, volume, cpc, competition, difficulty, intent, serp_features, trend |
| `labs difficulty <keywords...>` | Bulk keyword difficulty (0-100) for up to 1000 keywords. | 100 | $0.0122 | keyword, difficulty |
| `labs intent <keywords...>` | Search intent (informational, navigational, commercial, transactional) for up to 1000 keywords. | 100 | $0.0122 | keyword, intent, probability, secondary |
| `labs history <keywords...>`<br>`--months` | Historical monthly search volume per keyword (one column per month). | 100 | $0.0121 | keyword, volume, <YYYY-MM>... |
| `labs ranked <target>`<br>`--order` | Keywords a domain or URL ranks for, with position, volume and estimated traffic. | 20 | $0.0126 | keyword, pos, volume, cpc, difficulty, intent, etv, type, url |
| `labs domain-overview <target>` | Domain ranking overview: organic keywords, traffic estimate, top-3/top-10 counts, paid keywords. | all | $0.0121 | target, keywords, etv, traffic_cost, top3, top10, new, lost, paid_keywords, paid_etv |
| `labs competitors <target>` | Organic competitor domains of a domain (shared keywords, their size). | 20 | $0.0126 | domain, shared, avg_pos, keywords, etv |
| `labs intersection <target1> <target2>`<br>`--gap` `--order` | Keywords two domains both rank for (or --gap: keywords only the first ranks for). | 20 | $0.0126 | keyword, volume, difficulty, pos1, pos2, url1, url2 |
| `labs serp-competitors <keywords...>` | Domains that rank for a set of keywords (who owns this topic). | 20 | $0.0126 | domain, keywords, avg_pos, median_pos, etv, visibility |
| `labs traffic <targets...>` | Bulk organic/paid traffic estimate for up to 1000 domains or URLs. | 100 | $0.0122 | target, etv, keywords, paid_etv, paid_keywords |
| `labs pages <target>` | A domain's pages ranked by organic traffic (relevant pages). | 20 | $0.0126 | url, keywords, etv, top3, top10 |
| `labs site-keywords <target>`<br>`--order` | Keywords relevant to a domain (Labs keywords_for_site). | 20 | $0.0126 | keyword, volume, cpc, competition, difficulty, intent |
| `labs top-searches `<br>`--order` | Top keywords in the Labs database for a location (filter with --param filters='[...]'). | 20 | $0.0126 | keyword, volume, cpc, competition, difficulty, intent |
| `labs amazon-volume <keywords...>` | Amazon search volume for up to 1000 keywords. | 100 | $0.0121 | keyword, volume |
| `labs amazon-related <keyword>`<br>`--depth` | Related Amazon keywords for a seed keyword. | 20 | $0.0126 | keyword, volume, depth |
| `labs amazon-ranked <asin>` | Amazon keywords a product (ASIN) ranks for. | 20 | $0.0126 | keyword, pos, volume, type |
| `labs amazon-competitors <asin>` | Products (ASINs) competing with an ASIN for the same Amazon keywords. | 20 | $0.0126 | asin, shared, avg_pos, keywords |

### `backlinks`

| Command | What it returns | Rows | Cost/call | Columns |
|---|---|---|---|---|
| `backlinks summary <target>` | Backlink profile summary of a domain, subdomain or URL. | all | $0.024 | target, rank, backlinks, ref_domains, ref_main_domains, ref_ips, nofollow_domains, broken, spam_score, first_seen |
| `backlinks list <target>`<br>`--mode` `--order` | Backlinks to a target (default: one per referring domain, strongest first). | 20 | $0.0242 | from_domain, from_url, to_url, anchor, dofollow, domain_rank, page_rank, first_seen, lost |
| `backlinks domains <target>`<br>`--order` | Referring domains of a target. | 20 | $0.0242 | domain, rank, backlinks, spam_score, first_seen |
| `backlinks anchors <target>`<br>`--order` | Anchor texts pointing to a target. | 20 | $0.0242 | anchor, backlinks, ref_domains, rank, first_seen |
| `backlinks bulk-ranks <targets...>` | Rank (0-1000 domain strength) for up to 1000 targets. | 100 | $0.0241 | target, rank |
| `backlinks bulk-backlinks <targets...>` | Backlink counts for up to 1000 targets. | 100 | $0.0241 | target, backlinks |
| `backlinks competitors <target>` | Domains sharing the most referring domains with a target. | 20 | $0.0242 | domain, rank, shared |
| `backlinks intersection <targets...>`<br>`--exclude` | Referring domains that link to all given targets (link gap: add --exclude <domain>). | 20 | $0.0242 | domain, rank, <target>_backlinks... |
| `backlinks history <target>`<br>`--from` | Monthly backlink history of a domain (rank, backlinks, referring domains, new/lost). | 24 | $0.0242 | date, rank, backlinks, ref_domains, new_backlinks, lost_backlinks, new_domains, lost_domains |

### `onpage`

| Command | What it returns | Rows | Cost/call | Columns |
|---|---|---|---|---|
| `onpage instant <url>`<br>`--js` | Instant SEO audit of one page: status, title, description, H1, word count, links, load time, issues. | all | $0.0001 | url, status, score, title, description, h1, words, int_links, ext_links, load_ms, issues |
| `onpage parse <url>`<br>`--markdown` | Parse a page's main content into headings and text (or --markdown for the page as markdown). | 40 | $0.0001 | level, heading, text (or: markdown) |
| `onpage lighthouse <url>`<br>`--mobile` `--audits` | Lighthouse scores and Core Web Vitals for a URL (--audits lists failing audits). | 30 | $0.005 | url, performance, accessibility, best_practices, seo, lcp, cls, tbt, fcp, speed_index (or with --audits: audit, score, title, value) |

### `content-analysis` (alias `content`)

| Command | What it returns | Rows | Cost/call | Columns |
|---|---|---|---|---|
| `content-analysis search <keyword>`<br>`--page-type` | Pages that mention a keyword or brand, with sentiment. | 20 | $0.0242 | date, domain, title, url, sentiment, snippet |
| `content-analysis summary <keyword>` | Overview of mentions: total, sentiment split, top domains, countries, categories. | all | $0.024 | keyword, mentions, sentiment, emotions, top_domains, countries, languages, page_types |
| `content-analysis sentiment <keyword>` | Mentions per sentiment (positive/negative/neutral) and emotion, with top domains. | all | $0.024 | kind (sentiment\|emotion), label, mentions, top_domains |
| `content-analysis phrase-trends <keyword>`<br>`--from` `--group` | Mentions of a keyword over time with sentiment. | all | $0.0243 | date, mentions, sentiment, top_domains |

### `domain-analytics` (alias `domain`)

| Command | What it returns | Rows | Cost/call | Columns |
|---|---|---|---|---|
| `domain-analytics tech <domain>` | Technologies a website uses (CMS, analytics, ecommerce, payment...). | all | $0.012 | group, category, technologies |
| `domain-analytics whois <domains...>` | WHOIS overview with SEO metrics for one or more domains ($0.12 per call). | 10 | $0.1212 | domain, created, expires, registrar, keywords, etv, ref_domains, backlinks |

### `merchant`

| Command | What it returns | Rows | Cost/call | Columns |
|---|---|---|---|---|
| `merchant amazon-products <keyword>`<br>`--depth` `--sort-by` | Amazon search results for a keyword (price, rating, reviews, badges). | 20 | $0.0033 | pos, asin, title, price, rating, reviews, badges |
| `merchant amazon-product <asin>`<br>`--reviews` | Amazon product details for an ASIN: price, rating, BSR, brand, categories, top reviews. | 20 | $0.005 | asin, title, brand, price, rating, reviews, bsr, available, categories, description (or with --reviews: date, rating, title, text, verified) |
| `merchant amazon-sellers <asin>` | Sellers offering an ASIN (price, condition, ships from, seller rating). | 20 | $0.0033 | seller, price, condition, ships_from, rating, ratings |
| `merchant google-products <keyword>`<br>`--depth` | Google Shopping results for a keyword (queue task; takes ~1 minute). Queue task (~1 min). | 20 | $0.001 | pos, title, price, seller, rating, reviews, product_id |
| `merchant google-sellers <product_id>` | Sellers of a Google Shopping product (by product_id from google-products; queue task). Queue task (~1 min). | 20 | $0.001 | seller, domain, price, total_price, shipping, rating |
| `merchant google-product <product_id>` | Google Shopping product details (by product_id; queue task). Queue task (~1 min). | all | $0.001 | generic (trimmed) |

### `app-data` (alias `apps`)

| Command | What it returns | Rows | Cost/call | Columns |
|---|---|---|---|---|
| `app-data apple-search <keyword>`<br>`--depth` | App Store search results for a keyword (queue task). Queue task (~1 min). | 20 | $0.0012 | pos, app_id, title, developer, rating, reviews, price |
| `app-data apple-info <app_id>` | App Store app details (queue task). Queue task (~1 min). | all | $0.0006 | app_id, title, developer, rating, reviews, installs, price, version, updated, released, categories, description |
| `app-data apple-reviews <app_id>`<br>`--depth` `--sort-by` | App Store reviews for an app (queue task; --depth reviews, billed per 100 on Apple / 150 on Google). Queue task (~1 min). | 50 | $0.0008 | date, rating, title, text, version, helpful |
| `app-data apple-listings [title]`<br>`--description` `--category` | App Store app listings database search by title/description keyword or category ($0.10+ per call). | 20 | $0.103 | app_id, title, developer, rating, reviews, installs, price, category |
| `app-data google-search <keyword>`<br>`--depth` | Google Play search results for a keyword (queue task). Queue task (~1 min). | 20 | $0.0012 | pos, app_id, title, developer, rating, reviews, price |
| `app-data google-info <app_id>` | Google Play app details (queue task). Queue task (~1 min). | all | $0.0006 | app_id, title, developer, rating, reviews, installs, price, version, updated, released, categories, description |
| `app-data google-reviews <app_id>`<br>`--depth` `--sort-by` | Google Play reviews for an app (queue task; --depth reviews, billed per 100 on Apple / 150 on Google). Queue task (~1 min). | 50 | $0.0008 | date, rating, title, text, version, helpful |
| `app-data google-listings [title]`<br>`--description` `--category` | Google Play app listings database search by title/description keyword or category ($0.10+ per call). | 20 | $0.103 | app_id, title, developer, rating, reviews, installs, price, category |

### `business-data` (alias `business`)

| Command | What it returns | Rows | Cost/call | Columns |
|---|---|---|---|---|
| `business-data trustpilot-search <keyword>`<br>`--depth` | Find Trustpilot business profiles by name or category (queue task). Queue task (~1 min). | 20 | $0.0008 | pos, name, domain, rating, reviews |
| `business-data trustpilot-reviews <domain>`<br>`--depth` `--sort-by` | Trustpilot reviews of a domain (queue task; billed per 20 reviews). Queue task (~1 min). | 40 | $0.0008 | date, rating, title, text, country, verified, replied |
| `business-data google-reviews [business]`<br>`--cid` `--place-id` `--depth` `--sort-by` | Google reviews of a business by name (+ --location) or --cid/--place-id (queue task). Queue task (~1 min). | 40 | $0.0015 | date, rating, text, owner_answered, reviewer_reviews |
| `business-data google-business <business>` | Google Business Profile info for a business name (+ --location). | all | $0.0054 | title, category, rating, reviews, address, phone, domain, claimed, price_level, cid, place_id |
| `business-data tripadvisor-search <keyword>`<br>`--depth` | Find Tripadvisor listings (queue task). Queue task (~1 min). | 10 | $0.0008 | pos, title, rating, reviews, category, url_path |
| `business-data tripadvisor-reviews <url_path_or_keyword>`<br>`--depth` | Tripadvisor reviews by url_path (from tripadvisor-search) or keyword (queue task). Queue task (~1 min). | 40 | $0.0008 | date, rating, title, text, visit |
| `business-data listings [title]`<br>`--category` `--description` | Business listings database search by category/title (filters via --param filters='[...]'). | 20 | $0.0131 | title, category, rating, reviews, address, phone, domain, claimed |

### `ai`

| Command | What it returns | Rows | Cost/call | Columns |
|---|---|---|---|---|
| `ai mentions <target>`<br>`--platform` | LLM answers that mention a domain or keyword/brand, with AI search volume and cited sources ($0.10+ per call). | 10 | $0.103 | platform, question, ai_volume, answer, sources, brands |
| `ai mention-metrics <target>`<br>`--platform` `--top` | Aggregated LLM mention metrics for a domain or keyword (mentions, AI search volume, by platform). | all | $0.101 | dimension (platform\|sources_domain\|search_results_domain\|brand_entities_title\|brand_entities_category), key, mentions, ai_volume |
| `ai top-domains <target>`<br>`--platform` | Top domains mentioned in LLM answers about a domain or keyword ($0.10+ per call). | 20 | $0.105 | domain, mentions, ai_volume, google, chatgpt, top_sources |
| `ai top-pages <target>`<br>`--platform` | Top pages mentioned in LLM answers about a domain or keyword ($0.10+ per call). | 20 | $0.105 | page, mentions, ai_volume, google, chatgpt, top_sources |
| `ai top-brands <target>`<br>`--platform` | Top brands mentioned in LLM answers about a domain or keyword ($0.10+ per call). | 20 | $0.105 | brand, mentions, ai_volume, google, chatgpt, top_sources |
| `ai volume <keywords...>` | AI search volume (how often keywords are asked in AI assistants) with 12-month trend. | 100 | $0.0102 | keyword, ai_volume, trend |
| `ai ask <prompt>`<br>`--llm` `--model` `--web-search` `--max-tokens` | Ask an LLM through its API (chatgpt, claude, gemini, perplexity) and get the answer plus cited sources. | 30 | $0.0006 | type (answer\|source), model, title, url, text |
| `ai chatgpt-scrape <prompt>` | What ChatGPT's consumer web app answers for a prompt (scraped), with sources. | 30 | $0.004 | type (answer\|source), title, url, text |
| `ai gemini-scrape <prompt>` | What Gemini's consumer web app answers for a prompt (scraped), with sources. | 30 | $0.004 | type (answer\|source), title, url, text |

### `onpage crawl` (site crawl task)

| Command | What it returns |
|---|---|
| `onpage crawl <domain> --max-pages 20` | Crawls the site (billed per page, about $0.00015), waits for it, then prints `# summary` (pages, onpage score, broken links, duplicates), `# issues` (check name, pages affected) and `# pages` (url, status, score, title, description, h1, words, links, load_ms, issues). |
| `onpage result <task-id>` | The same report for an earlier crawl (use when `crawl` timed out). |

### `api`: any endpoint

Covers all 565 DataForSEO v3 endpoints (paths and parameters come from DataForSEO's OpenAPI spec). Output still goes through the trimmer: envelope and noise removed, nested fields flattened into dotted columns, empty values dropped, text truncated, default 50 rows.

```bash
dataforseo-cli api --list jobs                                   # find endpoints (path, method, queue?, description)
dataforseo-cli api --describe serp/google/jobs/live/advanced     # its request fields
dataforseo-cli api serp/google/jobs/live/advanced keyword="seo manager" location_code=2840
dataforseo-cli api serp/google/jobs/live/advanced --body '{"keyword":"seo manager","location_code":2840}'
dataforseo-cli api backlinks/referring_networks/live --body-file body.json
echo '[{"target":"example.com"}]' | dataforseo-cli api backlinks/summary/live
dataforseo-cli api serp/google/organic/live/advanced --queue --body '{"keyword":"x","location_code":2840}'
dataforseo-cli api ai_optimization/claude/llm_responses/models   # GET endpoints need no body
```

Request fields go after the path as `key=value` (values that parse as JSON, such as `2840`, `true` or `["a","b"]`, keep their type), or as `--body` with one task object or an array of tasks (`--body -` reads stdin). A `task_post` path is polled until the result is ready.

## Notes

- Amazon product reviews have no endpoint in DataForSEO v3 any more; `merchant amazon-product <asin> --reviews` lists the top reviews shown on the product page.
- `trends google` returns related queries and topics only for a single keyword (a Google Trends limit); with 2-5 keywords it returns the time series and regions.
- Google Ads volumes are rounded buckets (e.g. 673000) and trends for low-volume keywords repeat the same bucket; Labs and clickstream volumes are finer.

## Development

```bash
npm run build          # TypeScript -> dist/
npm test               # vitest: core helpers + every command mapper against recorded fixtures
npm run smoke          # one real, cheap call per typed command (spends money; stops at SMOKE_BUDGET, default $3)
npm run smoke -- --cached serp,labs     # reuse cached responses; filter by command name
npm run smoke -- --record && node scripts/make-fixtures.mjs   # refresh test fixtures
npm run gen-endpoints  # refresh data/endpoints.json from DataForSEO's OpenAPI spec
```

Typed commands are declared in `src/commands/*.ts` (endpoint, request body, column mapping); `src/client.ts` handles cache, cost guard, queue polling and errors; `src/trim.ts` holds the generic trimmer used by `api`.

## Agent skill

[SKILL.md](./SKILL.md) follows the [Agent Skills](https://agentskills.io) format: `npx skills add alexgusevski/dataforseo-cli`.

## Author

**Alexander Gusev** ([@alexgusevski](https://github.com/alexgusevski))

## License

MIT
