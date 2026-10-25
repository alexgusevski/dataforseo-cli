#!/usr/bin/env node
// Turn raw responses recorded by `scripts/smoke.sh --record` (test/fixtures/raw/*.json)
// into small, account-neutral test fixtures (test/fixtures/*.json):
// task ids zeroed, timings removed, `items` lists cut to 12 entries, other lists to 60.
import fs from "fs";
import path from "path";

const dir = new URL("../test/fixtures/", import.meta.url).pathname;
const rawDir = path.join(dir, "raw");
const MAX_ITEMS = 12;
const MAX_OTHER = 60;
// Layout data and Lighthouse audit details are large and never read by the CLI.
const DROP = new Set(["xpath", "rectangle", "details", "screenshot", "i18n", "timing", "stackPacks"]);

function shrink(v, key = "") {
  if (Array.isArray(v)) return v.slice(0, key === "items" ? MAX_ITEMS : MAX_OTHER).map((x) => shrink(x));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (DROP.has(k)) continue;
      out[k] = shrink(x, k);
    }
    return out;
  }
  return v;
}

for (const f of fs.readdirSync(rawDir).filter((f) => f.endsWith(".json"))) {
  const raw = JSON.parse(fs.readFileSync(path.join(rawDir, f), "utf8"));
  raw.time = "0 sec.";
  for (const t of raw.tasks || []) {
    t.id = "00000000-0000-0000-0000-000000000000";
    t.time = "0 sec.";
    if (t.data) delete t.data.tag;
  }
  const json = JSON.stringify(shrink(raw));
  if (/"login"|"password"|@beundra/i.test(json)) throw new Error(`${f} contains account data`);
  fs.writeFileSync(path.join(dir, f), json);
  console.log(`${f}\t${json.length} bytes`);
}
