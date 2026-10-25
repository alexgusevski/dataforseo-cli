// Turns bloated API responses into compact rows. Typed commands pick their own
// columns with the helpers below; `api` uses genericRows() for any endpoint.

export type Row = Record<string, any>;

export interface TrimOptions {
  fullText?: boolean;
  maxText?: number;
}

export const DEFAULT_TEXT = 160;

// Envelope, metadata, layout and tracking fields that research never uses.
const NOISE = new Set([
  "login", "password", "version", "status_code", "status_message", "time", "cost", "tasks_count", "tasks_error",
  "id", "path", "data", "result_count", "items_count", "se_domain", "check_url", "datetime",
  "spell", "refinement_chips", "item_types", "xpath", "rectangle", "rank_absolute", "se_type",
  "tag", "position_type",
  "image_url", "images", "thumbnail", "thumbnail_url", "favicon", "icon", "logo", "pixel",
  "cache_url", "related_search_url", "screenshot", "encoded_url", "ads_url", "image_alt",
  "breadcrumb", "about_this_result", "highlighted", "is_image", "is_video", "is_malicious",
  "is_web_story", "amp_version", "main_domain", "website_name", "pre_snippet", "extended_snippet",
  "last_updated_time", "previous_updated_time", "se", "feature_id", "cid", "place_id",
  "data_attrid", "data_cid", "data_docid", "data_pid", "source_url_tracking", "tracking_url",
  "shop_ad_aclk", "xpath_path", "url_image", "image", "images_count", "photo", "photos",
  "main_image", "avatar", "profile_image_url", "user_profile_url", "check_url_tracking",
  "monthly_searches_ts", "keyword_info_normalized_with_bing", "keyword_info_normalized_with_clickstream",
  "serp_info", "avg_backlinks_info", "search_intent_info_raw", "currency",
]);

// Request echoes: dropped from a result set when every row carries the same value.
const ECHO = ["location_code", "language_code", "language_name", "location_name", "se_type", "device", "os"];

// Fields whose zero is meaningful and must survive the "drop zero defaults" rule.
const KEEP_ZERO = new Set(["search_volume", "volume", "position", "pos", "rank", "rank_group", "rating", "difficulty", "keyword_difficulty"]);

const LABEL_KEYS = ["keyword", "title", "question", "domain", "name", "text", "anchor", "url", "type"];

export function truncate(text: any, opts: TrimOptions = {}, max?: number): string {
  if (text === null || text === undefined) return "";
  const s = String(text).replace(/\s+/g, " ").trim();
  if (opts.fullText) return s;
  const n = max ?? opts.maxText ?? DEFAULT_TEXT;
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

// Markdown to plain text: drop images and citation links, keep link text.
export function stripMarkdown(md: any): string {
  if (!md) return "";
  return String(md)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[\d+\]\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Remove click-tracking query parameters from result URLs.
export function cleanUrl(url: any): string {
  if (!url || typeof url !== "string") return "";
  return url.replace(/([?&])(srsltid|utm_[a-z]+|gclid|fbclid|ved|sa|usg)=[^&#]*/g, "$1").replace(/[?&]+(#|$)/, "$1").replace(/\?&/, "?");
}

export function round(n: any): any {
  if (typeof n !== "number" || !isFinite(n) || Number.isInteger(n)) return n;
  if (Math.abs(n) >= 1) return Math.round(n * 100) / 100;
  return Number(n.toPrecision(3));
}

export function domainOf(url: any): string {
  if (!url || typeof url !== "string") return "";
  if (!url.includes("/") && !url.includes(":")) return url.replace(/^www\./, "");
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

export function isEmpty(v: any, key = ""): boolean {
  if (v === null || v === undefined || v === "" || v === false) return true;
  if (v === 0 && !KEEP_ZERO.has(key)) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

// Join a short list, e.g. "a; b; c (+4)".
export function list(values: any[], max = 5, sep = "; "): string {
  const clean = values.filter((v) => v !== null && v !== undefined && v !== "").map(String);
  const head = clean.slice(0, max).join(sep);
  return clean.length > max ? `${head} (+${clean.length - max})` : head;
}

function label(obj: any): string {
  if (obj === null || typeof obj !== "object") return String(obj);
  for (const k of LABEL_KEYS) if (typeof obj[k] === "string" && obj[k]) return obj[k];
  return "";
}

// Flatten one object into dotted columns, dropping noise and empties.
export function flatten(obj: any, opts: TrimOptions = {}, prefix = "", depth = 0, out: Row = {}): Row {
  for (const [k, v] of Object.entries(obj || {})) {
    if (NOISE.has(k) || /(_url_tracking|_image|_thumbnail|_icon|_logo)$/.test(k)) continue;
    if (isEmpty(v, k)) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      if (v.every((x) => x === null || typeof x !== "object")) {
        out[key] = truncate(list(v.map(round), 12, ","), opts);
      } else {
        const labels = v.map(label).filter(Boolean);
        out[key] = labels.length ? truncate(list(labels), opts) : `${v.length} items`;
      }
    } else if (typeof v === "object") {
      if (depth >= 2) {
        const l = label(v);
        if (l) out[key] = truncate(l, opts);
      } else {
        flatten(v, opts, key, depth + 1, out);
      }
    } else if (typeof v === "string") {
      out[key] = truncate(v, opts);
    } else {
      out[key] = round(v);
    }
  }
  return out;
}

export function results(response: any): any[] {
  const out: any[] = [];
  for (const t of response?.tasks || []) for (const r of t?.result || []) if (r) out.push(r);
  return out;
}

export function items(response: any): any[] {
  return results(response).flatMap((r) => r.items || []);
}

// Total rows the API says exist (for the "N more rows" hint).
export function totalCount(response: any): number | undefined {
  let total = 0;
  let seen = false;
  for (const r of results(response)) {
    if (typeof r.total_count === "number") {
      total += r.total_count;
      seen = true;
    }
  }
  return seen ? total : undefined;
}

export function genericRows(response: any, opts: TrimOptions = {}): { rows: Row[]; total?: number } {
  const res = results(response);
  const rows: Row[] = [];
  const multi = res.length > 1;
  for (const r of res) {
    if (Array.isArray(r.items) && r.items.length) {
      const ctx = multi ? r.keyword ?? r.target ?? r.se_domain : undefined;
      for (const it of r.items) {
        const row = flatten(it, opts);
        rows.push(ctx && !("keyword" in row) && !("target" in row) ? { query: ctx, ...row } : row);
      }
    } else {
      const { items: _items, ...rest } = r;
      const row = flatten(rest, opts);
      if (Object.keys(row).length) rows.push(row);
    }
  }
  return { rows: dropEchoes(rows), total: totalCount(response) };
}

export function dropEchoes(rows: Row[]): Row[] {
  if (rows.length < 2) return rows.map((r) => omit(r, ECHO));
  const constant = ECHO.filter((k) => rows.every((r) => r[k] === rows[0][k]));
  return constant.length ? rows.map((r) => omit(r, constant)) : rows;
}

function omit(row: Row, keys: string[]): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (!keys.includes(k)) out[k] = v;
  return out;
}
