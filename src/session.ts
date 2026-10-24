import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Running spend total across CLI invocations. A session ends after 6 idle hours.
const FILE = path.join(os.homedir(), ".cache", "dataforseo-cli", "session.json");
const IDLE_MS = 6 * 3600 * 1000;

export interface Session {
  start: number;
  last: number;
  total: number;
  calls: number;
}

export function readSession(): Session {
  try {
    const s: Session = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    if (Date.now() - s.last < IDLE_MS) return s;
  } catch {
    // no session yet
  }
  const now = Date.now();
  return { start: now, last: now, total: 0, calls: 0 };
}

export function addCost(cost: number): Session {
  const s = readSession();
  s.total = Math.round((s.total + cost) * 1e6) / 1e6;
  s.calls += 1;
  s.last = Date.now();
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(s));
  } catch {
    // non-fatal
  }
  return s;
}

export function resetSession(): void {
  try {
    fs.unlinkSync(FILE);
  } catch {
    // already reset
  }
}
