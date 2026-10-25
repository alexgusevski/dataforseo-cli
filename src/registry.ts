import * as fs from "fs";
import { Command } from "commander";
import { call, CliError, statusLine } from "./client";
import { render } from "./output";
import { genericRows, Row, TrimOptions } from "./trim";

export interface Ctx {
  args: any[];
  opts: any;
  limit: number;
  trim: TrimOptions;
}

export interface Mapped {
  rows: Row[];
  total?: number;
  sections?: { name: string; rows: Row[] }[]; // several small tables instead of rows
}

export interface TypedCommand {
  name: string;
  aliases?: string[];
  desc: string;
  path: string | ((ctx: Ctx) => string); // live path, or task_post path for queue-only endpoints
  args?: string[]; // commander argument specs, e.g. "<keyword>"
  options?: [string, string, string?][]; // [flags, description, default]
  geo?: "full" | "location" | "none"; // adds --location / --language (default full)
  geoDefault?: { location?: string; language?: string };
  limit?: number; // default rows shown (0 = no limit)
  apiLimit?: string | false; // body field that receives --limit (default "limit")
  apiLimitMax?: number;
  ttl: number; // cache hours
  body: (ctx: Ctx) => Record<string, any> | Record<string, any>[];
  map?: (response: any, ctx: Ctx) => Mapped;
  columns?: string; // documented output columns
}

const isNum = (v: string) => /^\d+$/.test(String(v).trim());

// --location accepts a code (2752) or a name ("Sweden", "Stockholm,Stockholm County,Sweden").
export function geo(opts: any, mode: "full" | "location" = "full"): Record<string, any> {
  const out: Record<string, any> = {};
  if (opts.location !== undefined && opts.location !== "") {
    if (isNum(opts.location)) out.location_code = parseInt(opts.location);
    else out.location_name = opts.location;
  }
  if (mode === "full" && opts.language) {
    if (/^[a-z]{2,3}([-_][a-z]{2,4})?$/i.test(opts.language)) out.language_code = opts.language;
    else out.language_name = opts.language;
  }
  return out;
}

// --param key=value pairs, values parsed as JSON when possible.
function extraParams(list: string[] | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const p of list || []) {
    const i = p.indexOf("=");
    if (i < 1) throw new CliError(`--param expects key=value, got "${p}"`);
    const v = p.slice(i + 1);
    try {
      out[p.slice(0, i)] = JSON.parse(v);
    } catch {
      out[p.slice(0, i)] = v;
    }
  }
  return out;
}

const collect = (v: string, prev: string[] = []) => [...prev, v];

export function outputOptions(cmd: Command): Command {
  return cmd
    .option("--json", "Output trimmed rows as compact JSON")
    .option("--table", "Output as human-readable table")
    .option("--human", "Alias for --table")
    .option("--fields <list>", "Only these columns (comma-separated)")
    .option("--full-text", "Do not truncate long text")
    .option("-q, --quiet", "No cost/status line on stderr");
}

export function callOptions(cmd: Command): Command {
  return cmd
    .option("--no-cache", "Skip the cache and make a fresh call")
    .option("--queue", "Use the cheaper task queue (task_post + polling) instead of live")
    .option("--live", "Use the live endpoint (default when available)")
    .option("--timeout <sec>", "Queue polling timeout in seconds", "600")
    .option("--max-cost <usd>", "Refuse if the estimated cost exceeds this (default: config max_cost or 1)")
    .option("--raw-file <path>", "Write the untouched API response to a file (debugging, not for agents)");
}

export function fail(e: any): never {
  const msg = e instanceof CliError ? e.message : e?.message || String(e);
  console.error(`Error: ${msg}`);
  process.exit(1);
}

export function callOpts(opts: any, ttl: number) {
  return {
    ttlHours: ttl,
    noCache: opts.cache === false,
    queue: !!opts.queue && !opts.live,
    timeoutSec: parseInt(opts.timeout ?? "600"),
    rawFile: opts.rawFile,
    maxCost: opts.maxCost !== undefined ? parseFloat(opts.maxCost) : undefined,
  };
}

export function emit(mapped: Mapped, opts: any, limit: number): void {
  if (mapped.sections) return emitSections(mapped.sections, opts, limit);
  const { text, shown, more } = render(mapped.rows, {
    json: opts.json,
    table: opts.table,
    human: opts.human,
    limit,
    fields: opts.fields,
    total: mapped.total,
  });
  console.log(text);
  if (!opts.quiet) process.stderr.write(statusLine(shown) + (opts.json && more > 0 ? ` more=${more}` : "") + "\n");
}

function emitSections(sections: { name: string; rows: Row[] }[], opts: any, limit: number): void {
  const parts: string[] = [];
  const json: Record<string, any> = {};
  let shown = 0;
  for (const s of sections) {
    if (!s.rows.length) continue;
    const r = render(s.rows, { ...opts, limit });
    shown += r.shown;
    if (opts.json) json[s.name] = JSON.parse(r.text);
    else parts.push(`# ${s.name}\n${r.text}`);
  }
  console.log(opts.json ? JSON.stringify(json) : parts.join("\n\n") || "No results.");
  if (!opts.quiet) process.stderr.write(statusLine(shown) + "\n");
}

// Every typed command by its full name ("serp organic"), for tests and docs.
export const REGISTERED = new Map<string, TypedCommand>();

export function register(parent: Command, def: TypedCommand): Command {
  REGISTERED.set(`${parent.name()} ${def.name}`, def);
  const cmd = parent.command(def.name).description(def.desc);
  for (const a of def.aliases || []) cmd.alias(a);
  for (const a of def.args || []) cmd.argument(a);
  const geoMode = def.geo ?? "full";
  if (geoMode !== "none") {
    cmd.option("-l, --location <code|name>", "Location code or name", def.geoDefault?.location ?? "2840");
    if (geoMode === "full") cmd.option("--language <code|name>", "Language code or name", def.geoDefault?.language ?? "en");
  }
  for (const [flags, desc, dflt] of def.options || []) {
    if (dflt !== undefined) cmd.option(flags, desc, dflt);
    else cmd.option(flags, desc);
  }
  if (def.limit !== 0) cmd.option("-n, --limit <n>", "Max rows", String(def.limit ?? 20));
  cmd.option("--param <key=value>", "Extra API body field (repeatable)", collect);
  callOptions(outputOptions(cmd));
  if (def.columns) cmd.addHelpText("after", `\nColumns: ${def.columns}`);

  cmd.action(async (...raw: any[]) => {
    const opts = raw[raw.length - 2];
    const args = raw.slice(0, raw.length - 2);
    try {
      const limit = def.limit === 0 ? 0 : parseInt(opts.limit ?? String(def.limit ?? 20));
      const ctx: Ctx = { args, opts, limit, trim: { fullText: !!opts.fullText } };
      const built = def.body(ctx);
      const tasks = (Array.isArray(built) ? built : [built]).map((t) => {
        const task: Record<string, any> = geoMode === "none" ? { ...t } : { ...geo(opts, geoMode), ...t };
        const limKey = def.apiLimit === undefined ? "limit" : def.apiLimit;
        if (limKey && limit > 0 && task[limKey] === undefined) {
          task[limKey] = def.apiLimitMax ? Math.min(limit, def.apiLimitMax) : limit;
        }
        return { ...task, ...extraParams(opts.param) };
      });
      const path = typeof def.path === "function" ? def.path(ctx) : def.path;
      const { response } = await call(path, tasks, callOpts(opts, def.ttl));
      const mapped = def.map ? def.map(response, ctx) : genericRows(response, ctx.trim);
      emit(mapped, opts, limit);
    } catch (e) {
      fail(e);
    }
  });
  return cmd;
}

export function readBodyFile(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e: any) {
    throw new CliError(`Cannot read JSON body from ${file}: ${e.message}`);
  }
}
