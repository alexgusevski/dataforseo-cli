import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// The account's price list comes free with appendix/user_data. We keep only the
// `price` tree (no login or balance) and refresh it once a day.
const FILE = path.join(os.homedir(), ".cache", "dataforseo-cli", "prices.json");
const TTL_MS = 24 * 3600 * 1000;

type PriceLine = { cost_type: string; cost: number };

export interface Price {
  perRequest: number;
  perResult: number;
}

export function savePrices(price: any): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(price));
  } catch {
    // non-fatal
  }
}

export function cachedPrices(): any | null {
  try {
    const stat = fs.statSync(FILE);
    if (Date.now() - stat.mtimeMs > TTL_MS) return null;
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
  } catch {
    return null;
  }
}

// Walk the price tree along the endpoint path, skipping segments the tree does not
// split on (e.g. "google" in serp/google/organic/live/advanced).
export function priceFor(tree: any, endpoint: string): Price | null {
  if (!tree) return null;
  let node = tree;
  for (const seg of endpoint.split("/")) {
    if (node && typeof node === "object" && seg in node) node = node[seg];
  }
  for (const k of ["", "advanced", "live", "regular"]) {
    const n = k ? node?.[k] : node;
    const lines: PriceLine[] | undefined = n?.priority_normal;
    if (Array.isArray(lines)) {
      const sum = (t: string) => lines.filter((l) => l.cost_type === t).reduce((a, l) => a + l.cost, 0);
      return { perRequest: sum("per_request"), perResult: sum("per_result") };
    }
  }
  return null;
}

// Estimated USD for a body (array of tasks). Per-result prices assume `limit` results (100 if unset).
export function estimate(tree: any, endpoint: string, body: any): number | null {
  const price = priceFor(tree, endpoint);
  if (!price) return null;
  const tasks: any[] = Array.isArray(body) ? body : body ? [body] : [{}];
  let total = 0;
  for (const t of tasks) {
    const n = typeof t?.limit === "number" ? t.limit : 100;
    total += price.perRequest + (price.perResult ? price.perResult * n : 0);
  }
  return Math.round(total * 1e6) / 1e6;
}

// Flat "path = price" lines for `dataforseo-cli prices`.
export function flatten(tree: any): { endpoint: string; per_request: number; per_result: number }[] {
  const out: { endpoint: string; per_request: number; per_result: number }[] = [];
  const walk = (node: any, trail: string[]) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.priority_normal)) {
      const p = priceFor({ x: node }, "x")!;
      out.push({ endpoint: trail.join("/"), per_request: p.perRequest, per_result: p.perResult });
      return;
    }
    for (const k of Object.keys(node)) walk(node[k], [...trail, k]);
  };
  walk(tree, []);
  return out;
}
