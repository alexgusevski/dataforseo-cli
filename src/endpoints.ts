import * as fs from "fs";
import * as path from "path";

// Endpoint catalogue generated from DataForSEO's OpenAPI spec by scripts/gen-endpoints.mjs.
// p = request params as [name, type, required (1 yes, 2 one-of, 0 no), description].
export interface Endpoint {
  m: "GET" | "POST";
  d: string;
  p?: [string, string, number, string][];
}

let catalogue: Record<string, Endpoint> | null = null;

export function endpoints(): Record<string, Endpoint> {
  if (!catalogue) {
    const file = path.join(__dirname, "..", "data", "endpoints.json");
    catalogue = JSON.parse(fs.readFileSync(file, "utf-8"));
  }
  return catalogue!;
}

export function normalisePath(p: string): string {
  return p.trim().replace(/^https?:\/\/[^/]+/, "").replace(/^\/+/, "").replace(/^v3\//, "").replace(/\/+$/, "");
}

// Match a concrete path (e.g. .../task_get/advanced/abc-123) to its catalogue entry.
export function lookup(p: string): { key: string; ep: Endpoint } | null {
  const all = endpoints();
  if (all[p]) return { key: p, ep: all[p] };
  for (const [key, ep] of Object.entries(all)) {
    if (!key.includes("{")) continue;
    const re = new RegExp("^" + key.replace(/\{[^}]+\}/g, "[^/]+") + "$");
    if (re.test(p)) return { key, ep };
  }
  return null;
}

export interface QueuePaths {
  post: string;
  get: (id: string) => string;
}

// Derive the task_post / task_get pair for a live or task_post path, if the API has one.
export function queuePaths(p: string): QueuePaths | null {
  const all = endpoints();
  let base: string;
  let variant = "";
  const live = p.match(/^(.*)\/live(?:\/(advanced|regular|html|json))?$/);
  if (live) {
    base = live[1];
    variant = live[2] || "";
  } else if (p.endsWith("/task_post")) {
    base = p.slice(0, -"/task_post".length);
  } else {
    return null;
  }
  if (!all[`${base}/task_post`]) return null;
  const candidates = [variant, "advanced", "regular", ""].map((v) =>
    v ? `${base}/task_get/${v}/{id}` : `${base}/task_get/{id}`
  );
  const get = candidates.find((c) => all[c]);
  if (!get) return null;
  return { post: `${base}/task_post`, get: (id) => get.replace("{id}", id) };
}

export function hasLive(p: string): boolean {
  return !!endpoints()[p];
}
