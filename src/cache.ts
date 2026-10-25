import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

const CACHE_DIR = path.join(os.homedir(), ".cache", "dataforseo-cli");
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
    fs.mkdirSync(REQ_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(REQ_DIR, `${key}.json`), JSON.stringify(response), { mode: 0o600 });
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

export function printCache(): void {
  const { files, bytes } = requestStats();
  console.log(files ? `Cached responses: ${files} (${Math.round(bytes / 1024)} KB) in ${REQ_DIR}` : "Cache is empty.");
}
