import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

const CACHE_DIR = path.join(os.homedir(), ".cache", "dataforseo-cli");
const CACHE_FILE = path.join(CACHE_DIR, "cache.json");
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Cache structure: { [key]: { data: any, ts: number } }
interface CacheEntry {
  data: any;
  ts: number;
}
type CacheStore = Record<string, CacheEntry>;

function load(): CacheStore {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function save(store: CacheStore): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    // Prune expired entries on save
    const now = Date.now();
    const pruned: CacheStore = {};
    for (const [k, v] of Object.entries(store)) {
      if (v && typeof v.ts === "number" && now - v.ts < TTL_MS) {
        pruned[k] = v;
      }
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(pruned));
  } catch {
    // Cache write failure is non-fatal
  }
}

// --- Request cache: one file per endpoint + normalised body ------------------

const REQ_DIR = path.join(CACHE_DIR, "requests");

// Sort object keys recursively so equivalent bodies produce the same key.
function normalise(value: any): any {
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value).sort()) {
      const v = value[k];
      if (v === undefined) continue;
      out[k] = typeof v === "string" && /(keyword|target|query)/.test(k) ? v.trim().toLowerCase() : normalise(v);
    }
    return out;
  }
  return value;
}

export function makeRequestKey(endpoint: string, body: unknown): string {
  const norm = JSON.stringify([endpoint.replace(/^\/+|\/+$/g, ""), normalise(body ?? null)]);
  return crypto.createHash("sha1").update(norm).digest("hex");
}

export function getRequest(key: string, ttlHours: number): any | null {
  if (ttlHours <= 0) return null;
  try {
    const file = path.join(REQ_DIR, `${key}.json`);
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > ttlHours * 3600 * 1000) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function setRequest(key: string, response: any): void {
  try {
    fs.mkdirSync(REQ_DIR, { recursive: true });
    fs.writeFileSync(path.join(REQ_DIR, `${key}.json`), JSON.stringify(response));
  } catch {
    // Cache write failure is non-fatal
  }
}

export function clearRequests(): number {
  let n = 0;
  try {
    for (const f of fs.readdirSync(REQ_DIR)) {
      fs.unlinkSync(path.join(REQ_DIR, f));
      n++;
    }
  } catch {
    // nothing cached
  }
  return n;
}

export function requestStats(): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  try {
    for (const f of fs.readdirSync(REQ_DIR)) {
      files++;
      bytes += fs.statSync(path.join(REQ_DIR, f)).size;
    }
  } catch {
    // nothing cached
  }
  return { files, bytes };
}

export function makeKey(command: string, query: string, location: number, language: string): string {
  return `${command}:${location}:${language}:${query.toLowerCase()}`;
}

export function get(key: string): any | null {
  const store = load();
  const entry = store[key];
  if (!entry || typeof entry.ts !== "number") return null;
  if (Date.now() - entry.ts > TTL_MS) return null;
  return entry.data;
}

export function set(key: string, data: any): void {
  const store = load();
  store[key] = { data, ts: Date.now() };
  save(store);
}

export function printCache(): void {
  const store = load();
  const now = Date.now();
  const entries = Object.entries(store).filter(
    ([, v]) => v && typeof v.ts === "number" && now - v.ts < TTL_MS
  );

  const req = requestStats();
  if (req.files > 0) {
    console.log(`Request cache: ${req.files} responses (${Math.round(req.bytes / 1024)} KB) in ${REQ_DIR}\n`);
  }

  if (entries.length === 0) {
    console.log("Keyword cache is empty.");
    return;
  }

  // Group by command
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const [command] = entry[0].split(":");
    if (!groups.has(command)) groups.set(command, []);
    groups.get(command)!.push(entry);
  }

  console.log(`Cached entries: ${entries.length}\n`);

  for (const [command, group] of groups) {
    console.log(`[${command}] (${group.length} entries)`);
    for (const [key, entry] of group) {
      const daysAgo = Math.floor((now - entry.ts) / (24 * 60 * 60 * 1000));
      const [, location, language, ...queryParts] = key.split(":");
      const query = queryParts.join(":");

      if (command === "volume") {
        const d = entry.data;
        console.log(`  "${d.keyword}" vol=${d.volume} cpc=${d.cpc} diff=${d.difficulty ?? "?"} | loc=${location} lang=${language} | ${daysAgo}d ago`);
      } else {
        const items: any[] = Array.isArray(entry.data) ? entry.data : [];
        console.log(`  "${query}" | loc=${location} lang=${language} | ${daysAgo}d ago`);
        for (const item of items) {
          const kw = item.keyword || "?";
          const vol = item.volume ?? "?";
          const diff = item.difficulty ?? "?";
          console.log(`    ${kw} (vol=${vol}, diff=${diff})`);
        }
      }
    }
    console.log();
  }
}
