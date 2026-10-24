import * as fs from "fs";
import { getAuthHeader, getSetting } from "./config";
import * as cache from "./cache";
import { lookup, normalisePath, queuePaths, hasLive } from "./endpoints";
import { cachedPrices, estimate, savePrices } from "./prices";
import { addCost, readSession } from "./session";

const BASE = "https://api.dataforseo.com/v3";
const DEFAULT_MAX_COST = 1;

export class CliError extends Error {}

export interface CallOptions {
  ttlHours?: number; // 0 = never cache
  noCache?: boolean;
  queue?: boolean; // use task_post + task_get instead of live
  timeoutSec?: number; // queue polling timeout
  rawFile?: string; // write the untouched response here
  maxCost?: number; // USD cap for this call
}

export interface CallResult {
  response: any;
  cost: number;
  cached: boolean;
}

// Per-process totals, printed as one stderr line when the command finishes.
export const tally = { cost: 0, calls: 0, cached: 0 };

// --- Errors -----------------------------------------------------------------

export function explain(code: number | undefined, message: string, endpoint: string): string {
  const msg = (message || "unknown error").replace(/\s+/g, " ").trim();
  const api = endpoint.split("/")[0];
  const head = code ? `API error ${code}: ${msg}` : msg;
  if (code === 40100 || code === 401 || /not authori[sz]ed|authentication/i.test(msg))
    return `${head}. Credentials rejected; run: dataforseo-cli --set-credentials login=XXX password=XXX`;
  if (code === 40204 || /subscription|access denied|not activated|plan/i.test(msg))
    return `${head}. This account has no access to the ${api} API; activate it in the DataForSEO dashboard (Plans and Subscriptions).`;
  if (code === 40200 || code === 40210 || /balance|insufficient|payment required|funds/i.test(msg))
    return `${head}. Out of balance; top up at app.dataforseo.com (check with: dataforseo-cli balance).`;
  if (code === 40202 || code === 40209 || /rate limit|too many/i.test(msg))
    return `${head}. Rate limited; wait a minute and retry, or use --queue.`;
  if (/location/i.test(msg))
    return `${head}. Find a valid code: dataforseo-cli locations <name> --api ${api === "dataforseo_labs" ? "labs" : api}`;
  if (/language/i.test(msg))
    return `${head}. Find a valid code: dataforseo-cli languages <name>`;
  if (code === 40400 || code === 404 || /not found/i.test(msg))
    return `${head}. List endpoints with: dataforseo-cli api --list <filter>`;
  if (code && code >= 40500 && code < 40600)
    return `${head}. Check parameters with: dataforseo-cli api --describe ${endpoint}`;
  return head;
}

function checkResponse(data: any, endpoint: string): void {
  if (!data || typeof data !== "object") throw new CliError(`Unexpected response from ${endpoint}`);
  if (data.status_code !== 20000) throw new CliError(explain(data.status_code, data.status_message, endpoint));
  const tasks: any[] = data.tasks || [];
  const failed = tasks.filter((t) => t.status_code >= 40000);
  if (tasks.length && failed.length === tasks.length) {
    throw new CliError(explain(failed[0].status_code, failed[0].status_message, endpoint));
  }
  if (failed.length) {
    process.stderr.write(`warn: ${failed.length}/${tasks.length} tasks failed: ${failed[0].status_message}\n`);
  }
}

// --- HTTP ---------------------------------------------------------------------

async function http(method: string, endpoint: string, body?: unknown): Promise<any> {
  const opts: RequestInit = {
    method,
    headers: { Authorization: getAuthHeader(), "Content-Type": "application/json" },
    signal: AbortSignal.timeout(180_000),
  };
  if (method === "POST") opts.body = JSON.stringify(body ?? []);
  let res: Response;
  try {
    res = await fetch(`${BASE}/${endpoint}`, opts);
  } catch (e: any) {
    const why = e?.name === "TimeoutError" ? "request timed out after 180s" : e?.cause?.code || e?.message;
    throw new CliError(`Network error (${why}). Check the connection; sandboxes may block network access.`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError(explain(res.status, `HTTP ${res.status} ${res.statusText}`, endpoint));
  }
}

// --- Cost guard -----------------------------------------------------------------

async function priceTree(): Promise<any | null> {
  const cached = cachedPrices();
  if (cached) return cached;
  try {
    const data = await http("GET", "appendix/user_data");
    const price = data?.tasks?.[0]?.result?.[0]?.price;
    if (price) savePrices(price);
    return price ?? null;
  } catch {
    return null;
  }
}

export async function estimateCost(endpoint: string, body: unknown): Promise<number | null> {
  return estimate(await priceTree(), endpoint, body);
}

async function guard(endpoint: string, body: unknown, maxCost?: number): Promise<void> {
  const est = await estimateCost(endpoint, body);
  if (est === null) return;
  const cap = maxCost ?? getSetting("max_cost") ?? DEFAULT_MAX_COST;
  if (est > cap) {
    throw new CliError(
      `Estimated cost $${est.toFixed(4)} exceeds --max-cost $${cap}. Narrow the request (--limit, fewer keywords) or raise --max-cost.`
    );
  }
  const sessionCap = getSetting("session_cap");
  if (sessionCap !== undefined) {
    const s = readSession();
    if (s.total + est > sessionCap) {
      throw new CliError(
        `Session spend $${s.total.toFixed(4)} + estimated $${est.toFixed(4)} exceeds session_cap $${sessionCap}. Reset with: dataforseo-cli session --reset`
      );
    }
  }
}

// --- Queue mode ------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runQueued(endpoint: string, body: unknown, timeoutSec: number): Promise<any> {
  const q = queuePaths(endpoint);
  if (!q) throw new CliError(`${endpoint} has no queue (task_post) mode; drop --queue.`);
  const posted = await http("POST", q.post, body);
  checkResponse(posted, q.post);
  const ids: string[] = (posted.tasks || []).filter((t: any) => t.status_code < 40000).map((t: any) => t.id);
  process.stderr.write(`queued ${ids.length} task(s); polling up to ${timeoutSec}s\n`);
  const done = new Map<string, any>();
  const deadline = Date.now() + timeoutSec * 1000;
  let wait = 3000;
  while (done.size < ids.length) {
    if (Date.now() > deadline) {
      const pending = ids.filter((id) => !done.has(id));
      throw new CliError(
        `Queue timeout after ${timeoutSec}s; fetch later with: dataforseo-cli api ${q.get(pending[0])}` +
          (pending.length > 1 ? ` (and ${pending.length - 1} more task ids)` : "")
      );
    }
    await sleep(wait);
    wait = Math.min(wait + 2000, 10000);
    for (const id of ids) {
      if (done.has(id)) continue;
      const got = await http("GET", q.get(id));
      const task = got?.tasks?.[0];
      // 40601 = handed to crawler, 40602 = in queue: keep waiting
      if (task && (task.status_code === 40601 || task.status_code === 40602)) continue;
      done.set(id, task);
    }
  }
  return {
    ...posted,
    tasks: ids.map((id) => {
      const t = done.get(id);
      const p = posted.tasks.find((x: any) => x.id === id);
      return { ...t, cost: (p?.cost ?? 0) + (t?.cost ?? 0) };
    }),
  };
}

// --- Main entry -------------------------------------------------------------------

export async function call(rawPath: string, body?: unknown, opts: CallOptions = {}): Promise<CallResult> {
  const endpoint = normalisePath(rawPath);
  const found = lookup(endpoint);
  const method = body !== undefined ? "POST" : found?.ep.m ?? "GET";
  const tasks = body === undefined ? undefined : Array.isArray(body) ? body : [body];

  // Queue-only endpoints (task_post with no live variant) always go through the queue.
  const queueOnly = endpoint.endsWith("/task_post") && !!queuePaths(endpoint);
  const useQueue = (opts.queue && !!queuePaths(endpoint)) || queueOnly;
  if (opts.queue && !queuePaths(endpoint)) {
    throw new CliError(`${endpoint} has no queue (task_post) mode; drop --queue.`);
  }

  const ttl = opts.noCache ? 0 : opts.ttlHours ?? 24;
  const key = cache.makeRequestKey(endpoint, tasks ?? null);
  const hit = cache.getRequest(key, ttl);
  if (hit) {
    tally.calls++;
    tally.cached++;
    if (opts.rawFile) fs.writeFileSync(opts.rawFile, JSON.stringify(hit, null, 1));
    return { response: hit, cost: 0, cached: true };
  }

  if (method === "POST") await guard(useQueue ? queuePaths(endpoint)!.post : endpoint, tasks, opts.maxCost);

  let response: any;
  if (useQueue) {
    response = await runQueued(endpoint, tasks, opts.timeoutSec ?? 600);
  } else {
    if (endpoint.endsWith("/task_post") && !hasLive(endpoint)) {
      throw new CliError(`${endpoint}: unknown endpoint. List endpoints with: dataforseo-cli api --list`);
    }
    response = await http(method, endpoint, tasks);
  }
  if (opts.rawFile) fs.writeFileSync(opts.rawFile, JSON.stringify(response, null, 1));
  checkResponse(response, endpoint);

  const cost = useQueue
    ? (response.tasks || []).reduce((a: number, t: any) => a + (t?.cost ?? 0), 0)
    : response.cost ?? 0;
  if (cost > 0) addCost(cost);
  tally.cost += cost;
  tally.calls++;
  if (ttl > 0) cache.setRequest(key, response);
  return { response, cost, cached: false };
}

export function statusLine(rows: number | null): string {
  const cached = tally.calls === 0 ? "n/a" : tally.cached === tally.calls ? "yes" : tally.cached ? "partial" : "no";
  const s = readSession();
  const parts = [`cost=$${tally.cost.toFixed(4)}`];
  if (rows !== null) parts.push(`rows=${rows}`);
  parts.push(`cached=${cached}`, `session=$${s.total.toFixed(4)}`);
  return parts.join(" ");
}
