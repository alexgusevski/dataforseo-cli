// Helpers for typed commands: pick curated columns out of API items.
import { Ctx, Mapped } from "./registry";
import { domainOf, items, list, results, round, Row, totalCount, TrimOptions, truncate } from "./trim";

export type Getter = string | ((it: any, ctx: Ctx) => any);
export type ColSpec = Record<string, Getter>;

// Dotted path with alternatives: "rating.value|rating".
export function get(obj: any, path: string): any {
  for (const alt of path.split("|")) {
    let cur = obj;
    for (const seg of alt.split(".")) {
      if (cur === null || cur === undefined) break;
      cur = cur[seg];
    }
    if (cur !== null && cur !== undefined && cur !== "") return cur;
  }
  return undefined;
}

export function value(v: any, trim: TrimOptions): any {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "y" : "";
  if (typeof v === "number") return round(v);
  if (typeof v === "string") return truncate(v, trim);
  if (Array.isArray(v)) {
    const flat = v.map((x) => (x && typeof x === "object" ? x.title ?? x.name ?? x.keyword ?? x.domain ?? x.url ?? "" : x));
    return truncate(list(flat, 8, ", "), trim);
  }
  if (typeof v === "object") return truncate(v.title ?? v.name ?? v.value ?? "", trim);
  return String(v);
}

export function pick(it: any, spec: ColSpec, ctx: Ctx): Row {
  const row: Row = {};
  for (const [col, g] of Object.entries(spec)) {
    const v = typeof g === "function" ? g(it, ctx) : get(it, g);
    row[col] = value(v, ctx.trim);
  }
  return row;
}

export const fromItems =
  (spec: ColSpec, filter?: (it: any) => boolean) =>
  (resp: any, ctx: Ctx): Mapped => {
    const all = items(resp).filter((i) => i && (!filter || filter(i)));
    return { rows: all.map((i) => pick(i, spec, ctx)), total: totalCount(resp) };
  };

export const fromResults =
  (spec: ColSpec) =>
  (resp: any, ctx: Ctx): Mapped => ({ rows: results(resp).map((r) => pick(r, spec, ctx)) });

// Monthly volumes, newest first, as "v1,v2,...".
export function trend(monthly: any, n = 12, field = "search_volume"): string {
  if (!Array.isArray(monthly)) return "";
  const sorted = [...monthly].sort((a, b) => b.year - a.year || b.month - a.month);
  return sorted
    .slice(0, n)
    .map((m) => m[field] ?? "")
    .join(",");
}

export const dom = (path: string) => (it: any) => domainOf(get(it, path));

export function date(v: any): string {
  if (!v || typeof v !== "string") return "";
  return v.slice(0, 10);
}

export function textOf(it: any, ctx: Ctx, max?: number): string {
  return truncate(it, ctx.trim, max);
}

export { domainOf, list, truncate, round };
