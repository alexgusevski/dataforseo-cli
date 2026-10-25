#!/usr/bin/env node
import { Command } from "commander";
import { setApiKey, setCredentials, checkCredentials } from "./config";
import {
  searchVolume,
  relatedKeywords,
  competitorKeywords,
  locations,
  languages,
  apiLocations,
  apiLanguages,
  GEO_APIS,
} from "./api";
import { getFormat, output, formatTsv, formatJson } from "./formatters";
import { statusLine } from "./client";
import { registerAll } from "./commands";

function done(rows: number): void {
  process.stderr.write(statusLine(rows) + "\n");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const program = new Command();

program
  .name("dataforseo-cli")
  .description(
    "Agent-friendly CLI for the whole DataForSEO v3 API: SERPs with AI Overviews, Trends, keywords, competitors, backlinks, Amazon, reviews, app stores, LLM mentions. Prints compact TSV, never raw API JSON."
  )
  .addHelpText(
    "after",
    `
Start here:
  dataforseo-cli status                          credentials configured? (free)
  dataforseo-cli <group> --help                  commands in a group, e.g. serp, labs, merchant
  dataforseo-cli <group> <command> --help        flags and output columns

Common research jobs:
  volume "kw1" "kw2" -l 2752 --language sv       search volume, CPC, difficulty, 12-month trend
  labs suggestions "creatine" -n 50              more keywords around a topic
  trends google "creatine"                       Google Trends: time series, regions, related queries
  serp organic "is creatine safe"                top results + AI Overview (cited URLs) + People Also Ask
  labs domain-overview thorne.com                a competitor's keywords, traffic, top-10 counts
  labs competitors thorne.com                    competing domains
  merchant amazon-products "creatine gummies"    Amazon results: ASIN, price, rating, reviews
  business-data trustpilot-reviews thorne.com    Trustpilot reviews
  app-data apple-reviews 389801252               App Store reviews (google-reviews for Play)
  ai mentions thorne.com                         brand mentions in ChatGPT and AI Overviews
  api --list jobs                                any other endpoint: find it, --describe it, call it

Output: TSV on stdout (--json for compact JSON, --fields to pick columns, -n to change the row limit).
One status line on stderr: cost=$… rows=… cached=… session=$…  Calls estimated above --max-cost
(default $1) are refused. -l takes a location code or name, --language a code or name (default US, en).`
  )
  .version(require("../package.json").version);

// Handle --print-cache before parsing commands
if (process.argv.includes("--print-cache")) {
  const { printCache } = require("./cache");
  printCache();
  process.exit(0);
}

// Handle --set-credentials / --set-api-key before parsing commands
const setCredsIdx = Math.max(
  process.argv.indexOf("--set-credentials"),
  process.argv.indexOf("--set-api-key")
);
if (setCredsIdx !== -1) {
  const creds: Record<string, string> = {};
  for (const part of process.argv.slice(setCredsIdx + 1)) {
    const [k, v] = part.split("=");
    if (k && v) creds[k] = v;
  }
  if (creds.base64) {
    setCredentials(undefined, undefined, creds.base64);
  } else if (creds.login && creds.password) {
    setCredentials(creds.login, creds.password);
  } else {
    console.error("Usage: dataforseo-cli --set-credentials login=XXX password=XXX");
    console.error("   or: dataforseo-cli --set-credentials base64=YOUR_BASE64_TOKEN");
    process.exit(1);
  }
  process.exit(0);
}

const outputOpts = (cmd: Command) =>
  cmd
    .option("--json", "Output as JSON")
    .option("--table", "Output as human-readable table")
    .option("--human", "Alias for --table");

// Volume command
outputOpts(
  program
    .command("volume")
    .description("Get search volume, CPC, and difficulty for keywords")
    .argument("<keywords...>", "Keywords to look up")
    .option("-l, --location <code>", "Location code", "2840")
    .option("--language <code>", "Language code", "en")
).action(async (keywords: string[], opts) => {
  try {
    const fmt = getFormat(opts);
    const results = await searchVolume(
      keywords,
      parseInt(opts.location),
      opts.language
    );
    const rows = results.map((r) => ({
      keyword: r.keyword,
      volume: r.volume,
      cpc: round2(r.cpc),
      difficulty: r.difficulty ?? "",
      competition: r.competition,
      trend: r.trend.join(","),
    }));
    console.log(output(rows, fmt));
    done(rows.length);
  } catch (e: any) {
    console.error("Error:", e.message);
    process.exit(1);
  }
});

// Related command
outputOpts(
  program
    .command("related")
    .description("Find related keywords from a seed keyword")
    .argument("<seed>", "Seed keyword")
    .option("-l, --location <code>", "Location code", "2840")
    .option("--language <code>", "Language code", "en")
    .option("-n, --limit <n>", "Max results", "50")
).action(async (seed: string, opts) => {
  try {
    const fmt = getFormat(opts);
    const results = await relatedKeywords(
      seed,
      parseInt(opts.location),
      opts.language,
      parseInt(opts.limit)
    );
    const rows = results.map((r) => ({
      keyword: r.keyword,
      volume: r.volume,
      cpc: round2(r.cpc),
      difficulty: r.difficulty ?? "",
      competition: round2(r.competition),
    }));
    console.log(output(rows, fmt));
    done(rows.length);
  } catch (e: any) {
    console.error("Error:", e.message);
    process.exit(1);
  }
});

// Competitor command
outputOpts(
  program
    .command("competitor")
    .description("Get keywords a domain ranks for")
    .argument("<domain>", "Target domain")
    .option("-l, --location <code>", "Location code", "2840")
    .option("--language <code>", "Language code", "en")
    .option("-n, --limit <n>", "Max results", "50")
).action(async (domain: string, opts) => {
  try {
    const fmt = getFormat(opts);
    const results = await competitorKeywords(
      domain,
      parseInt(opts.location),
      opts.language,
      parseInt(opts.limit)
    );
    const rows = results.map((r) => ({
      keyword: r.keyword,
      pos: r.position,
      volume: r.volume,
      cpc: round2(r.cpc),
      difficulty: r.difficulty ?? "",
      url: r.url,
    }));
    console.log(output(rows, fmt));
    done(rows.length);
  } catch (e: any) {
    console.error("Error:", e.message);
    process.exit(1);
  }
});

// Status command
program
  .command("status")
  .description("Check if API credentials are configured")
  .action(() => {
    const { configured, maskedLogin } = checkCredentials();
    if (configured) {
      console.log(`✓ Credentials configured (login: ${maskedLogin})`);
    } else {
      console.log("✗ No credentials configured");
      console.log("Run: dataforseo-cli --set-credentials login=XXX password=XXX");
      process.exit(1);
    }
  });

// Locations command
program
  .command("locations")
  .description("Search location codes")
  .argument("[search]", "Filter locations by name")
  .option("--json", "Output as JSON")
  .option("--api <api>", `Location list of a specific API: ${Object.keys(GEO_APIS).join(", ")} (default: ads)`)
  .action(async (search: string | undefined, opts: any) => {
    try {
      const results = opts.api ? await apiLocations(opts.api, search) : await locations(search);
      console.log(opts.json ? formatJson(results) : formatTsv(results));
    } catch (e: any) {
      console.error("Error:", e.message);
      process.exit(1);
    }
  });

// Languages command
program
  .command("languages")
  .description("Search language codes")
  .argument("[search]", "Filter languages by name")
  .option("--json", "Output as JSON")
  .option("--api <api>", "Language list of a specific API (see locations --help)")
  .action(async (search: string | undefined, opts: any) => {
    try {
      const results = opts.api ? await apiLanguages(opts.api, search) : await languages(search);
      console.log(opts.json ? formatJson(results) : formatTsv(results));
    } catch (e: any) {
      console.error("Error:", e.message);
      process.exit(1);
    }
  });

registerAll(program);

program.parseAsync();
