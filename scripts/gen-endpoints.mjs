#!/usr/bin/env node
// Regenerates data/endpoints.json from DataForSEO's published OpenAPI spec
// (github.com/dataforseo/OpenApiDocumentation). Usage: node scripts/gen-endpoints.mjs [spec.yaml]
import fs from "fs";
import yaml from "js-yaml";

const SPEC_URL =
  "https://raw.githubusercontent.com/dataforseo/OpenApiDocumentation/HEAD/openapi_specification.yaml";

const src = process.argv[2]
  ? fs.readFileSync(process.argv[2], "utf8")
  : await (await fetch(SPEC_URL)).text();
const spec = yaml.load(src);
const schemas = spec.components.schemas;
const deref = (s) => (s && s.$ref ? schemas[s.$ref.split("/").pop()] : s);

function clean(text = "") {
  return text
    .replace(/<a [^>]*>.*?<\/a>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/(required field|optional field|default value|max(imum)? value|can take the values|example)/gi, "; $1")
    .replace(/\s+/g, " ")
    .replace(/^[;\s]+/, "")
    .replace(/\s*;\s*;?/g, "; ")
    .trim();
}

function firstSentence(text = "") {
  const t = text.split("\n")[0].replace(/\s+/g, " ").trim();
  const m = t.match(/^(.{20,}?[.!?])\s/);
  return (m ? m[1] : t).slice(0, 140);
}

function typeOf(s) {
  s = deref(s) || {};
  if (s.oneOf || s.anyOf) return typeOf((s.oneOf || s.anyOf)[0]);
  if (s.type === "array") return typeOf(s.items) + "[]";
  return s.type || "object";
}

const out = {};
for (const [p, ops] of Object.entries(spec.paths)) {
  const method = ops.post ? "POST" : "GET";
  const op = ops.post || ops.get;
  const entry = { m: method, d: firstSentence(clean(op.description).replace(/; /g, " ")) };
  const reqSchema = op.requestBody?.content?.["application/json"]?.schema;
  if (reqSchema) {
    const item = reqSchema.items?.oneOf ? reqSchema.items.oneOf[0] : reqSchema.items;
    const rq = deref(item);
    if (rq?.properties) {
      const required = new Set(rq.required || []);
      entry.p = Object.entries(rq.properties).map(([name, s]) => {
        const desc = clean(deref(s)?.description || "");
        const req = required.has(name) || /^[^;]*; required field(?! if)/i.test(desc) ? 1 : /required field if/i.test(desc) ? 2 : 0;
        return [name, typeOf(s), req, desc.replace(/; (required|optional) field;?/i, ";").slice(0, 160)];
      });
    }
  }
  out[p.replace(/^\/v3\//, "")] = entry;
}
fs.writeFileSync(new URL("../data/endpoints.json", import.meta.url), JSON.stringify(out));
console.log(`wrote ${Object.keys(out).length} endpoints`);
