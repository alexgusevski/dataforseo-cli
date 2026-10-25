#!/usr/bin/env node
import { Command } from "commander";
import { setCredentials, checkCredentials } from "./config";
import { registerAll } from "./commands";

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
  labs overview "kw1" "kw2" -l 2752 --language sv  volume, CPC, difficulty, intent, 12-month trend
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
    const i = part.indexOf("=");
    if (i > 0) creds[part.slice(0, i)] = part.slice(i + 1);
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

registerAll(program);

program.parseAsync();
