# DataForSEO API Quick Reference

## Visual Decision Tree

```
Need keyword data?
│
├─ I have keywords, need metrics → Search Volume
│  └─ Returns: volume, CPC, competition, trend
│
├─ I have seed words, need ideas → Keywords For Keywords
│  └─ Returns: related keywords + metrics
│
├─ I have a domain, want their keywords → Keywords For Site
│  └─ Returns: what domain ranks for + metrics
│
├─ I want to forecast ad performance → Ad Traffic By Keywords
│  └─ Returns: impressions, clicks, costs
│
└─ I want actual search results → SERP API (different use case)
   └─ Returns: Google SERP with rankings
```

---

## Example Responses (Cleaned vs Bloated)

### ❌ BLOATED (Current DataForSEO Response)
```json
{
  "keyword": "buy laptop",
  "spell": null,
  "location_code": 2840,
  "language_code": "en",
  "search_partners": false,
  "competition": "HIGH",
  "competition_index": 100,
  "search_volume": 2900,
  "low_top_of_page_bid": 1.69,
  "high_top_of_page_bid": 10.04,
  "cpc": 7.95,
  "monthly_searches": [
    {"year": 2023, "month": 10, "search_volume": 2400},
    {"year": 2023, "month": 9, "search_volume": 2900},
    {"year": 2023, "month": 8, "search_volume": 3600},
    {"year": 2023, "month": 7, "search_volume": 2900},
    {"year": 2023, "month": 6, "search_volume": 2400},
    {"year": 2023, "month": 5, "search_volume": 2900},
    {"year": 2023, "month": 4, "search_volume": 2900},
    {"year": 2023, "month": 3, "search_volume": 2900},
    {"year": 2023, "month": 2, "search_volume": 2900},
    {"year": 2023, "month": 1, "search_volume": 3600},
    {"year": 2022, "month": 12, "search_volume": 2900},
    {"year": 2022, "month": 11, "search_volume": 4400},
    {"year": 2022, "month": 10, "search_volume": 3600},
    {"year": 2022, "month": 9, "search_volume": 3600},
    {"year": 2022, "month": 8, "search_volume": 3600},
    {"year": 2022, "month": 7, "search_volume": 3600},
    {"year": 2022, "month": 6, "search_volume": 6600},
    {"year": 2022, "month": 5, "search_volume": 5400},
    {"year": 2022, "month": 4, "search_volume": 4400},
    {"year": 2022, "month": 3, "search_volume": 4400},
    {"year": 2022, "month": 2, "search_volume": 3600},
    {"year": 2022, "month": 1, "search_volume": 3600},
    {"year": 2021, "month": 12, "search_volume": 3600},
    {"year": 2021, "month": 11, "search_volume": 4400},
    {"year": 2021, "month": 10, "search_volume": 3600},
    {"year": 2021, "month": 9, "search_volume": 3600},
    {"year": 2021, "month": 8, "search_volume": 4400}
  ]
}
```
**Character count:** ~1,500 characters
**LLM tokens:** ~375 tokens
**Problem:** 90% of this is historical data you rarely need!

---

### ✅ CLEANED (Our CLI Default Output)
```json
{
  "keyword": "buy laptop",
  "volume": 2900,
  "difficulty": 100,
  "cpc": 7.95,
  "trend": "stable"
}
```
**Character count:** ~85 characters
**LLM tokens:** ~25 tokens
**Savings:** 93% smaller!

---

### 🔧 WITH --historical FLAG
```json
{
  "keyword": "buy laptop",
  "volume": 2900,
  "difficulty": 100,
  "cpc": 7.95,
  "trend": "stable",
  "trend_direction": "down",
  "trend_percentage": -12.5,
  "last_3_months": [2400, 2900, 3600],
  "yearly_average": 3200
}
```
**Includes:** Calculated trend, recent data, no 27-month bloat

---

## Pricing Comparison (Approximate)

| Endpoint | Cost per Request | Max Keywords | Cost per 1000 Keywords |
|----------|-----------------|--------------|------------------------|
| Search Volume | $0.075 | 1000 | $0.075 |
| Keywords For Keywords | $0.075 | N/A (generates list) | $0.075 |
| Keywords For Site | $0.075 | N/A (analyzes domain) | $0.075 |
| Ad Traffic | $0.075 | 1000 | $0.075 |
| SERP API | $0.003 | 1 (per search) | $3.00 |

**Key Insight:** Keyword Data API charges per request, not per keyword!
- 1 keyword = $0.075
- 1000 keywords = $0.075 (same price!)
- **Strategy:** Always batch keywords into groups of 1000

---

## Rate Limits

- **Keyword Data API:** 2000 requests/minute
- **SERP API:** Varies by plan
- **Solution:** Batch requests, implement queue system

---

## Common Pitfalls (from DataForSEO docs)

1. **Google Policy Restrictions**
   - Keywords about weapons, tobacco, drugs, etc. return NO data
   - If 1 restricted keyword in batch of 100 → ENTIRE batch fails
   - **Solution:** Pre-filter keywords, validate before sending

2. **Location Codes**
   - Must use specific codes (2840 = United States)
   - Wrong code = wrong data or error
   - **Solution:** Provide location lookup command

3. **Historical Data Confusion**
   - monthly_searches array includes ALL 27 months always
   - Most users only care about trend direction
   - **Solution:** Calculate trend, hide raw data by default

4. **Bid Parameter**
   - Ad Traffic endpoint requires bid value
   - Higher bid = more accurate forecast
   - **Solution:** Default to 999 (high bid), allow override

---

## Use Case Matrix

| Task | Best Endpoint | Command Example |
|------|--------------|-----------------|
| Check if keyword is worth targeting | Search Volume | `dfs volume "buy laptop"` |
| Find keyword alternatives | Keywords For Keywords | `dfs related "laptop"` |
| Spy on competitor keywords | Keywords For Site | `dfs competitor example.com` |
| Plan Google Ads budget | Ad Traffic | `dfs forecast "buy laptop" --bid 10` |
| See who ranks for keyword | SERP API | (v2 feature) |
| Find monthly trend | Search Volume + --historical | `dfs volume "laptop" --historical` |

---

## Authentication Flow

```bash
# Method 1: Config file (recommended)
dfs config set --login "your-login" --password "your-password"

# Method 2: Environment variables
export DATAFORSEO_LOGIN="your-login"
export DATAFORSEO_PASSWORD="your-password"

# Method 3: Command line (not recommended - visible in history)
dfs volume "keyword" --login "..." --password "..."
```

---

## Proposed CLI Structure

```
dfs/
├── commands/
│   ├── volume.js       # Search Volume endpoint
│   ├── related.js      # Keywords For Keywords endpoint
│   ├── competitor.js   # Keywords For Site endpoint
│   └── forecast.js     # Ad Traffic endpoint
├── utils/
│   ├── api.js          # API client wrapper
│   ├── filter.js       # Response filtering logic
│   ├── config.js       # Config file management
│   └── format.js       # Output formatting (JSON/CSV/table)
├── index.js            # CLI entry point
├── package.json
└── README.md
```

---

## Testing Strategy

1. **Unit Tests:** Filter logic, trend calculations
2. **Integration Tests:** API calls with test keywords
3. **LLM Tests:** Pass output to Claude/GPT, verify they can parse it
4. **Batch Tests:** Test with 1, 10, 100, 1000 keywords

---

**This document is meant to supplement RESEARCH.md for quick reference.**
