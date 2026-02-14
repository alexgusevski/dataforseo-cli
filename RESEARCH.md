# DataForSEO API Research - Keyword Research Focus

## Executive Summary

DataForSEO offers two main API categories for keyword research:

1. **Keywords Data API** - Based on Google Ads data (volume, CPC, competition)
2. **SERP API** - Based on actual Google search results (organic rankings, SERP features)

**Key Finding:** The APIs return VERY bloated responses with 100+ fields per keyword. Our CLI needs aggressive filtering to be LLM-friendly.

---

## 1. Keywords Data API (Google Ads Based)

### Base URL
`https://api.dataforseo.com/v3/keywords_data/google_ads/`

### Authentication
Basic Auth (username:password from DataForSEO dashboard)

### Cost Structure
- Live method: Results returned immediately, more expensive
- Standard method: Results stored for 30 days, requires POST then GET
- Rate limit: 2000 API calls/minute
- Pricing: ~$0.075 per request (check current pricing)

---

## 1.1 Search Volume Endpoint

**Purpose:** Get search volume and metrics for a list of keywords

**Endpoint:** `POST /v3/keywords_data/google_ads/search_volume/live`

### Request Parameters
```json
{
  "location_code": 2840,        // Required: US = 2840
  "language_code": "en",         // Optional
  "keywords": [                  // Required: max 1000 keywords
    "buy laptop",
    "cheap laptops"
  ],
  "search_partners": false,      // Optional: include Google partners
  "date_from": "2021-08-01"     // Optional: historical data start
}
```

### Response Fields (Essential Metrics)
- `keyword` - the keyword
- `search_volume` - average monthly searches
- `competition` - "LOW", "MEDIUM", "HIGH"
- `competition_index` - 0-100 scale
- `cpc` - cost per click (USD)
- `low_top_of_page_bid` - min bid to appear
- `high_top_of_page_bid` - max bid range
- `monthly_searches` - array of 27 months of historical data

### Response Fields (Bloat - Skip by default)
- Full monthly_searches array (27 months × 12 fields = 324 fields!)
- spell corrections
- keyword_annotations
- location_code, language_code (we already know these)

**Use Case:** Check search volume + CPC for a keyword list

---

## 1.2 Keywords For Keywords Endpoint

**Purpose:** Get related keyword suggestions based on seed keywords

**Endpoint:** `POST /v3/keywords_data/google_ads/keywords_for_keywords/live`

### Request Parameters
```json
{
  "location_code": 2840,
  "keywords": ["phone", "cellphone"]  // Seed keywords
}
```

### Response
Returns related keywords with same metrics as Search Volume endpoint

**Use Case:** Keyword expansion/discovery from seeds

---

## 1.3 Keywords For Site Endpoint

**Purpose:** Get keywords a domain/URL ranks for (competitive analysis)

**Endpoint:** `POST /v3/keywords_data/google_ads/keywords_for_site/live`

### Request Parameters
```json
{
  "location_code": 2840,
  "target": "example.com"  // Domain or URL
}
```

### Response
Returns keywords with metrics + `keyword_annotations.concepts` (brand vs non-brand classification)

**Use Case:** Competitor keyword analysis, find what domains rank for

---

## 1.4 Ad Traffic By Keywords Endpoint

**Purpose:** Forecast ad performance (impressions, clicks, costs)

**Endpoint:** `POST /v3/keywords_data/google_ads/ad_traffic_by_keywords/live`

### Request Parameters
```json
{
  "location_code": 2840,
  "language_code": "en",
  "bid": 999,              // Required: max CPC bid (higher = more accurate)
  "match": "exact",        // Required: "exact", "broad", "phrase"
  "keywords": ["seo marketing"],
  "date_interval": "next_month"  // or date_from/date_to
}
```

### Response Fields
- `impressions` - projected ad impressions
- `ctr` - click-through rate
- `average_cpc` - cost per click
- `cost` - total projected cost
- `clicks` - projected clicks

**Use Case:** Estimate ad campaign performance and costs

---

## 2. SERP API (Google Organic Search)

**Purpose:** Get actual Google search results and SERP features

**Endpoint:** `POST /v3/serp/google/organic/live/advanced`

### Request Parameters
```json
{
  "location_code": 2840,
  "language_code": "en",
  "keyword": "buy laptop",
  "device": "desktop",     // or "mobile"
  "depth": 100            // number of results (max 100)
}
```

### Response Fields
- `se_results_count` - total results
- `items` - array of SERP features:
  - `organic` - organic results with rank, URL, title, description
  - `paid` - paid ads
  - `people_also_ask` - PAA boxes
  - `featured_snippet` - position 0 results
  - `knowledge_graph` - right-side panels
  - Many more SERP features...

**Use Case:** Analyze actual SERPs, check competitors, SERP features

---

## 3. Key Differences Between Endpoints

| Feature | Search Volume | Keywords For Keywords | Keywords For Site | Ad Traffic | SERP API |
|---------|--------------|----------------------|------------------|-----------|----------|
| **Data Source** | Google Ads | Google Ads | Google Ads | Google Ads | Live Google |
| **Best For** | Volume/CPC check | Discovery | Competitor analysis | Ad forecasting | SERP analysis |
| **Input** | Keyword list | Seed keywords | Domain/URL | Keyword list + bid | Single keyword |
| **Output** | Metrics | Related keywords | Domain's keywords | Ad forecast | Search results |
| **Competition Data** | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **Historical Trends** | ✅ 27 months | ✅ 27 months | ✅ 27 months | ❌ No | ❌ No |
| **Cost per Request** | ~$0.075 | ~$0.075 | ~$0.075 | ~$0.075 | ~$0.003 |

---

## 4. Additional Endpoints (Not Covered in Detail)

- **Google Trends** - Trending topics and interest over time
- **Bing Keywords API** - Same structure but for Bing
- **Locations API** - Get location codes: `/v3/keywords_data/google_ads/locations`
- **Languages API** - Get language codes: `/v3/keywords_data/google_ads/languages`

---

## 5. LLM/Agent Optimization Strategy

### Problem: Response Bloat
A single keyword can return 500+ lines of JSON with:
- 27 months of historical data (unnecessary for most use cases)
- Redundant location/language codes
- Empty/null fields
- Nested annotations

### Solution: Aggressive Filtering
**Essential metrics only (default output):**
```json
{
  "keyword": "buy laptop",
  "volume": 2900,
  "difficulty": 100,        // competition_index 0-100
  "cpc": 7.95,
  "trend": "stable"         // calculated from last 3 months
}
```

**Optional flags for more data:**
- `--historical` - include monthly_searches array
- `--competition` - include competition text ("LOW", "MEDIUM", "HIGH")
- `--bids` - include low/high bid ranges
- `--full` - return complete API response

---

## 6. Recommended v1 Scope

Based on this research, here's my recommendation for v1:

### Core Commands

#### 1. `dfs volume <keywords>`
**What:** Get search volume + essential metrics
**Endpoint:** Search Volume
**Output:** keyword, volume, difficulty, cpc, trend
**Flags:** --historical, --full

#### 2. `dfs related <seed-keywords>`
**What:** Find related keywords
**Endpoint:** Keywords For Keywords
**Output:** Same as volume command
**Flags:** Same as volume

#### 3. `dfs competitor <domain>`
**What:** Get keywords a domain ranks for
**Endpoint:** Keywords For Site
**Output:** Same as volume command + ranking info
**Flags:** Same as volume

#### 4. `dfs forecast <keywords>`
**What:** Forecast ad performance
**Endpoint:** Ad Traffic By Keywords
**Output:** impressions, ctr, cpc, cost, clicks
**Requires:** --bid parameter

### Global Flags
- `--location <code>` - default: 2840 (US)
- `--language <code>` - default: "en"
- `--format <json|csv|table>` - default: json (for LLMs)
- `--config <path>` - config file for API keys

### Config File
```json
{
  "api_login": "your-login",
  "api_password": "your-password",
  "default_location": 2840,
  "default_language": "en"
}
```

---

## 7. What NOT to Include in v1

- SERP API (different use case, separate tool)
- Google Trends (too specialized)
- Bing (focus on Google first)
- Standard method (Live is simpler for v1)
- Historical data by default (bloat)

---

## 8. Next Steps

1. ✅ Research complete
2. ⏳ **Discuss with Alex** - decide final v1 scope
3. Build Node.js CLI with commander.js
4. Implement essential endpoints only
5. Add aggressive response filtering
6. Write clear documentation
7. Test with LLM tool calls

---

## Questions for Alex

1. Are these 4 commands the right scope for v1? Any you'd remove/add?
2. Should we include SERP API in v1 or save for v2?
3. Default output format - JSON for LLMs or human-readable tables?
4. Should we support both config file AND environment variables for auth?
5. Any specific use cases you have in mind that should influence design?

---

**Ready for discussion! 🚀**
