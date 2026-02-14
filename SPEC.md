# dataforseo-cli — V1 Spec

## What It Is
Lightweight TypeScript CLI for DataForSEO keyword research, designed for LLM/agent use. Open source, published to npm as `dataforseo-cli`.

## Why
Alex currently does keyword research manually in Semrush (volume, CPC, difficulty). This CLI lets Claude Code and other agents do it programmatically. Clean, non-bloated output optimized for LLM context windows (~93% smaller than raw API responses).

## V1 Commands

### 1. `dataforseo-cli volume <keywords...>`
Get search volume, CPC, difficulty for keywords.
- Default compact JSON output (keyword, volume, difficulty, cpc, trend)
- `--location <code>` (default: 2840 = USA)
- `--language <code>` (default: en)
- `--table` / `--human` for human-readable output

### 2. `dataforseo-cli related <seed>`
Find related keywords from a seed keyword.
- Same flags as volume

### 3. `dataforseo-cli competitor <domain>`
Get keywords a domain ranks for.
- Same flags as volume

### Utility Commands
- `dataforseo-cli locations [search]` — search location codes
- `dataforseo-cli languages [search]` — search language codes

### Auth
- `dataforseo-cli --set-api-key login=XXX password=XXX` — one-time setup, stores creds (NOT interactive prompt — must be scriptable for LLMs)
- Store creds like other CLI tools do (e.g. `~/.config/dataforseo-cli/config.json`)

## Tech Stack
- TypeScript
- Node.js
- Commander.js for CLI
- Published to npm (`npm install -g dataforseo-cli`)
- MIT license
- GitHub repo

## Package Structure
```
dataforseo-cli/
├── src/
│   ├── index.ts          # CLI entry (commander)
│   ├── api.ts            # DataForSEO API client
│   ├── commands/
│   │   ├── volume.ts
│   │   ├── related.ts
│   │   └── competitor.ts
│   ├── config.ts         # API key storage
│   └── formatters.ts     # JSON/table output
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE
```

## Design Principles
- Lightweight — minimal dependencies
- LLM-first — compact JSON by default, optional human output
- One-time auth — `--set-api-key`, no interactive prompts
- Batch-friendly — DataForSEO charges per request not per keyword, so always batch
- Descriptive name — `dataforseo-cli`

## After CLI is Built
- Create an OpenClaw/LLM skill (SKILL.md) for agents to use it
- Publish skill to clawhub

## Alex's DataForSEO Account
- Has $50 in credits on dataforseo.com
- No Semrush API (only $200/mo UI plan)
