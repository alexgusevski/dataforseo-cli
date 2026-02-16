#!/usr/bin/env node
import { Command } from "commander";
import { setApiKey, setCredentials, checkCredentials } from "./config";
import {
  searchVolume,
  relatedKeywords,
  competitorKeywords,
  locations,
  languages,
} from "./api";
import { getFormat, output, formatTsv, formatJson } from "./formatters";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const program = new Command();

program
  .name("dataforseo-cli")
  .description("Lightweight keyword research CLI powered by DataForSEO")
  .version("1.0.6");

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
  .action(async (search: string | undefined, opts: any) => {
    try {
      const results = await locations(search);
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
  .action(async (search: string | undefined, opts: any) => {
    try {
      const results = await languages(search);
      console.log(opts.json ? formatJson(results) : formatTsv(results));
    } catch (e: any) {
      console.error("Error:", e.message);
      process.exit(1);
    }
  });

program.parse();
