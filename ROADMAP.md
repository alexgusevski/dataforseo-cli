# DataForSEO CLI - Development Roadmap

## Current Status: ✅ Research Phase Complete

---

## Proposed v1.0 Scope

### Core Features
- ✅ 4 main commands (volume, related, competitor, forecast)
- ✅ Aggressive response filtering (93% size reduction)
- ✅ Config file for API credentials
- ✅ JSON output by default (LLM-friendly)
- ✅ Batch processing (up to 1000 keywords)
- ✅ Location/language support

### Commands

#### 1. `dfs volume <keywords...>`
Get search volume and metrics for keywords
```bash
# Single keyword
dfs volume "buy laptop"

# Multiple keywords
dfs volume "buy laptop" "cheap laptop" "laptop deals"

# From file
dfs volume --file keywords.txt

# With options
dfs volume "laptop" --location 2826 --language de --historical
```

#### 2. `dfs related <seed-keywords...>`
Find related keyword suggestions
```bash
dfs related "laptop"
dfs related "laptop" "computer" --limit 50
```

#### 3. `dfs competitor <domain>`
Get keywords a domain ranks for
```bash
dfs competitor example.com
dfs competitor example.com --limit 100
```

#### 4. `dfs forecast <keywords...> --bid <amount>`
Forecast ad performance and costs
```bash
dfs forecast "buy laptop" --bid 10
dfs forecast "laptop" "computer" --bid 5 --interval next_quarter
```

### Utility Commands

#### `dfs config`
Manage configuration
```bash
dfs config set --login "..." --password "..."
dfs config show
dfs config test  # Test API connection
```

#### `dfs locations [search]`
List available location codes
```bash
dfs locations
dfs locations "sweden"
dfs locations --code 2752  # Lookup by code
```

#### `dfs languages [search]`
List available language codes
```bash
dfs languages
dfs languages "english"
```

### Global Flags
- `--location <code>` - Location code (default: 2840 = US)
- `--language <code>` - Language code (default: en)
- `--format <json|csv|table>` - Output format
- `--full` - Return complete API response (no filtering)
- `--config <path>` - Custom config file path
- `--output <file>` - Save to file instead of stdout

---

## v1.0 Implementation Plan

### Phase 1: Foundation (Week 1)
- [x] Research DataForSEO API ← DONE
- [ ] Set up Node.js project with TypeScript (or plain JS?)
- [ ] Install dependencies (commander, axios, dotenv)
- [ ] Create project structure
- [ ] Implement config management
- [ ] Build API client wrapper with auth

### Phase 2: Core Commands (Week 1-2)
- [ ] Implement `volume` command
- [ ] Implement response filtering logic
- [ ] Add trend calculation
- [ ] Implement `related` command
- [ ] Implement `competitor` command
- [ ] Implement `forecast` command
- [ ] Add batch processing (handle 1000+ keywords)

### Phase 3: Output Formatting (Week 2)
- [ ] JSON formatter (default)
- [ ] CSV formatter
- [ ] Table formatter (for humans)
- [ ] File output support
- [ ] Error handling and user-friendly messages

### Phase 4: Utility Commands (Week 2)
- [ ] Locations command + search
- [ ] Languages command + search
- [ ] Config test command
- [ ] Help documentation

### Phase 5: Testing & Polish (Week 3)
- [ ] Unit tests for filters and formatters
- [ ] Integration tests with live API
- [ ] Test with various LLM tool call formats
- [ ] Write README with examples
- [ ] Write USAGE.md with all commands
- [ ] Add error handling for rate limits

### Phase 6: Distribution (Week 3)
- [ ] Package for npm
- [ ] Add installation instructions
- [ ] Create example workflows
- [ ] Optional: GitHub repo

---

## Technical Decisions to Make

### 1. Language
- **TypeScript** - Better type safety, autocomplete, maintainability
- **Plain JavaScript** - Faster to write, no build step

**Recommendation:** Plain JavaScript for v1 (speed), TypeScript for v2

### 2. Dependencies
```json
{
  "commander": "CLI framework",
  "axios": "HTTP client",
  "dotenv": "Environment variables",
  "chalk": "Colored terminal output",
  "ora": "Loading spinners",
  "cli-table3": "Table formatting",
  "csv-writer": "CSV export"
}
```

### 3. Config File Location
- `~/.dataforseocli/config.json` (Unix)
- `%APPDATA%/dataforseocli/config.json` (Windows)
- Current directory `.dataforseocli.json` (project-specific)

### 4. Error Handling
- Graceful degradation (skip failed keywords, continue batch)
- Retry logic for rate limits (exponential backoff)
- Clear error messages with suggestions

---

## Features Deferred to v2.0

### SERP API Integration
- Live Google search results
- SERP feature analysis
- Competitor ranking tracking

### Advanced Filtering
- Filter by volume range
- Filter by difficulty
- Filter by CPC range
- Regex pattern matching

### Caching
- Cache API responses locally
- Configurable TTL
- Cache invalidation

### Batch Operations
- Read from CSV
- Process multiple domains
- Scheduled runs (cron mode)

### Reporting
- HTML reports
- Comparison mode (before/after)
- Trend graphs (ASCII art or export to charts)

### Pro Features
- Keyword clustering
- SERP intent classification
- Opportunity score calculation
- Custom formulas/scoring

---

## Open Questions

1. **Package name?**
   - `dataforseo-cli` ✅ (descriptive)
   - `dfs-cli` (short, might be taken)
   - `@beundra/dataforseo` (scoped)

2. **Default behavior for large batches?**
   - Process all keywords in one request (fast, all-or-nothing)
   - Split into chunks of 100 (slower, more resilient)
   - User choice via flag?

3. **Trend calculation algorithm?**
   - Compare last 3 months to previous 3?
   - Linear regression?
   - Simple up/down/stable based on threshold?

4. **API key security?**
   - Store in plain text config? (simple)
   - Encrypt config file? (complex)
   - Use system keychain? (OS-dependent)

**Recommendation:** Plain text for v1 (user responsibility), add encryption in v2

---

## Success Metrics

### For v1.0
- [ ] Can query 1000 keywords in <5 seconds
- [ ] Response size reduced by >90%
- [ ] LLM can parse output without errors
- [ ] Works on Mac, Linux, Windows
- [ ] Error rate <1% (excluding API issues)
- [ ] Clear documentation with examples

### For v2.0
- [ ] 100+ active users
- [ ] Feature requests prioritized
- [ ] Integration with popular AI agents
- [ ] Community contributions

---

## Timeline

| Week | Focus | Deliverable |
|------|-------|-------------|
| Week 1 | Research + Foundation | ✅ Research docs + Basic CLI structure |
| Week 2 | Core Commands | Working volume, related, competitor commands |
| Week 3 | Polish + Testing | Complete v1.0, tested, documented |
| Week 4 | Release | Published to npm, announced |

**Estimated total time:** 3-4 weeks for v1.0

---

## Next Immediate Steps

1. **Discuss with Alex** ← YOU ARE HERE
   - Confirm v1 scope
   - Make technical decisions
   - Get approval to proceed

2. **Start coding** (after approval)
   - Initialize npm project
   - Build API client
   - Implement first command

---

**Ready to discuss and get approval to move forward! 🚀**
