import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { registerAll } from "../src/commands";
import { Mapped, REGISTERED } from "../src/registry";
import { render } from "../src/output";
import { genericRows } from "../src/trim";
import { CASES } from "./cases";

// Fixtures are real responses recorded by `scripts/smoke.sh --record`, shrunk and
// scrubbed by scripts/make-fixtures.mjs.
registerAll(new Command());
const DIR = path.join(__dirname, "fixtures");

function run(name: string): { mapped: Mapped; text: string } {
  const c = CASES[name];
  const def = REGISTERED.get(c.cmd);
  if (!def) throw new Error(`no command ${c.cmd}`);
  const resp = JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), "utf8"));
  const limit = def.limit === 0 ? 0 : def.limit ?? 20;
  const ctx = { args: c.args || [], opts: { ...c.opts }, limit, trim: {} };
  const mapped = def.map ? def.map(resp, ctx as any) : genericRows(resp);
  const text = mapped.sections
    ? mapped.sections.map((s) => render(s.rows, { limit }).text).join("\n")
    : render(mapped.rows, { limit, total: mapped.total }).text;
  return { mapped, text };
}

const rowsOf = (m: Mapped) => (m.sections ? m.sections.flatMap((s) => s.rows) : m.rows);

describe("every typed command maps its recorded response", () => {
  for (const name of Object.keys(CASES)) {
    const file = path.join(DIR, `${name}.json`);
    it.skipIf(!fs.existsSync(file))(name, () => {
      const { mapped, text } = run(name);
      expect(rowsOf(mapped).length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\b(xpath|rank_absolute|check_url|status_code|tasks_count|se_domain)\b/);
      expect(text).not.toContain("[object Object]");
    });
  }
});

describe("curated columns", () => {
  it("serp organic: AI Overview row first, cited URLs, PAA questions, organic positions", () => {
    const rows = run("serp-organic").mapped.rows;
    expect(rows[0]).toMatchObject({ type: "ai_overview" });
    expect(rows[0].title).toMatch(/^present \(\d+ cited\)$/);
    expect(rows.filter((r) => r.type === "aio_ref").length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.type === "paa").length).toBeGreaterThan(0);
    const organic = rows.filter((r) => r.type === "organic");
    expect(organic[0].pos).toBe(1);
    expect(organic[0].url).not.toContain("srsltid");
    expect(Object.keys(rows[0])).toEqual(["pos", "type", "domain", "title", "url", "snippet"]);
  });

  it("serp organic --types filters rows", () => {
    const c = CASES["serp-organic"];
    const def = REGISTERED.get(c.cmd)!;
    const resp = JSON.parse(fs.readFileSync(path.join(DIR, "serp-organic.json"), "utf8"));
    const rows = def.map!(resp, { args: c.args!, opts: { types: "paa" }, limit: 50, trim: {} }).rows;
    expect(new Set(rows.map((r) => r.type))).toEqual(new Set(["paa"]));
  });

  it("keywords volume keeps the legacy-style columns", () => {
    const rows = run("keywords-volume").mapped.rows;
    expect(Object.keys(rows[0])).toEqual(["keyword", "volume", "cpc", "competition", "comp_index", "bid_low", "bid_high", "trend"]);
    expect(rows[0].trend.split(",")).toHaveLength(12);
  });

  it("trends google returns monthly points per keyword", () => {
    const time = run("trends-google").mapped.sections!.find((s) => s.name === "time")!.rows;
    expect(time.length).toBeLessThanOrEqual(13);
    expect(Object.keys(time[0])).toEqual(["date", "creatine", "protein powder"]);
  });

  it("labs competitors drops the target itself", () => {
    expect(run("labs-competitors").mapped.rows.map((r) => r.domain)).not.toContain("thorne.com");
  });

  it("amazon product shows BSR without the 'See Top 100' noise", () => {
    const row = run("merchant-amazon-product").mapped.rows[0];
    expect(row.bsr).toMatch(/^#\d+ in /);
    expect(row.bsr).not.toMatch(/See Top 100/);
  });

  it("LLM answers are plain text with sources", () => {
    const rows = run("ai-ask-perplexity").mapped.rows;
    expect(rows[0].type).toBe("answer");
    expect(rows[0].text).not.toMatch(/\*\*|\]\(/);
    expect(rows.some((r) => r.type === "source")).toBe(true);
  });
});
