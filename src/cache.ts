import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash, randomUUID } from "crypto";
import { escapeTsvCell } from "./formatters";

const CACHE_DIR = path.join(os.homedir(), ".cache", "dataforseo-cli");
const ENTRY_DIR = path.join(CACHE_DIR, "entries");
const LEGACY_CACHE_FILE = path.join(CACHE_DIR, "cache.json");
const GC_MARKER_FILE = path.join(CACHE_DIR, ".last-gc");
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ABANDONED_TEMP_MS = 60 * 60 * 1000;
const ENTRY_FILE_PATTERN = /^[0-9a-f]{64}\.json$/;
const TEMP_FILE_PATTERN = /^\.[0-9a-f]{64}\.json\.\d+\.[0-9a-f-]+\.tmp$/;

interface CacheEntry {
  data: unknown;
  ts: number;
}

interface CacheEntryFile extends CacheEntry {
  key: string;
}

type CacheStore = Record<string, CacheEntry>;

function hardenDirectory(directory: string): void {
  if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
}

function hardenFile(filename: string): void {
  if (process.platform !== "win32") fs.chmodSync(filename, 0o600);
}

function isCacheEntry(value: unknown): value is CacheEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CacheEntry).ts === "number" &&
    Number.isFinite((value as CacheEntry).ts) &&
    Object.prototype.hasOwnProperty.call(value, "data")
  );
}

function entryFilename(key: string): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return path.join(ENTRY_DIR, `${digest}.json`);
}

function isFresh(entry: CacheEntry, now = Date.now()): boolean {
  return now - entry.ts < TTL_MS;
}

function removeFile(filename: string): void {
  try {
    fs.unlinkSync(filename);
  } catch {
    // Cache cleanup is best effort.
  }
}

function loadLegacy(): CacheStore {
  try {
    if (!fs.existsSync(LEGACY_CACHE_FILE)) return {};
    hardenDirectory(CACHE_DIR);
    hardenFile(LEGACY_CACHE_FILE);
    const parsed: unknown = JSON.parse(fs.readFileSync(LEGACY_CACHE_FILE, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

    const valid: CacheStore = {};
    const now = Date.now();
    for (const [key, value] of Object.entries(parsed)) {
      if (isCacheEntry(value) && isFresh(value, now)) valid[key] = value;
    }

    // Migrate the old shared object to independent atomic entries. This also
    // drops expired legacy values without risking cross-process lost updates.
    let fullyMigrated = true;
    for (const [key, entry] of Object.entries(valid)) {
      try {
        const current = loadEntryFile(entryFilename(key), key);
        if (current) {
          if (isFresh(current, now)) {
            valid[key] = { data: current.data, ts: current.ts };
          } else {
            // Leave the legacy source in place. A normal get can safely remove
            // the expired entry before attempting migration again.
            fullyMigrated = false;
          }
          continue;
        }

        if (!saveEntryIfAbsent(key, entry)) {
          // A concurrent writer won the create race. Prefer its value and only
          // retire the legacy file once the winner is readable.
          const winner = loadEntryFile(entryFilename(key), key);
          if (winner && isFresh(winner, now)) {
            valid[key] = { data: winner.data, ts: winner.ts };
          } else {
            fullyMigrated = false;
          }
        }
      } catch {
        fullyMigrated = false;
      }
    }
    if (fullyMigrated) removeFile(LEGACY_CACHE_FILE);
    return valid;
  } catch {
    return {};
  }
}

function loadEntryFile(filename: string, expectedKey?: string): CacheEntryFile | null {
  try {
    hardenDirectory(CACHE_DIR);
    hardenDirectory(ENTRY_DIR);
    hardenFile(filename);
    const parsed: unknown = JSON.parse(fs.readFileSync(filename, "utf-8"));
    if (
      !isCacheEntry(parsed) ||
      typeof (parsed as CacheEntryFile).key !== "string" ||
      (expectedKey !== undefined && (parsed as CacheEntryFile).key !== expectedKey) ||
      path.resolve(filename) !== path.resolve(entryFilename((parsed as CacheEntryFile).key))
    ) return null;
    return parsed as CacheEntryFile;
  } catch {
    return null;
  }
}

function loadAll(): CacheStore {
  const store = loadLegacy();
  const now = Date.now();
  try {
    if (!fs.existsSync(ENTRY_DIR)) return store;
    for (const filename of fs.readdirSync(ENTRY_DIR)) {
      if (!ENTRY_FILE_PATTERN.test(filename)) continue;
      const fullPath = path.join(ENTRY_DIR, filename);
      const entry = loadEntryFile(fullPath);
      if (!entry) continue;
      if (!isFresh(entry, now)) {
        removeFile(fullPath);
        continue;
      }
      const previous = store[entry.key];
      if (!previous || entry.ts >= previous.ts) {
        store[entry.key] = { data: entry.data, ts: entry.ts };
      }
    }
  } catch {
    // Cache reads are best effort.
  }
  return store;
}

function saveEntry(key: string, entry: CacheEntry): void {
  fs.mkdirSync(ENTRY_DIR, { recursive: true, mode: 0o700 });
  hardenDirectory(CACHE_DIR);
  hardenDirectory(ENTRY_DIR);

  const filename = entryFilename(key);
  const temporary = path.join(
    ENTRY_DIR,
    `.${path.basename(filename)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, JSON.stringify({ key, ...entry }), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    hardenFile(temporary);
    fs.renameSync(temporary, filename);
    hardenFile(filename);
  } finally {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      // A failed cleanup must not affect the research command.
    }
  }
}

function saveEntryIfAbsent(key: string, entry: CacheEntry): boolean {
  fs.mkdirSync(ENTRY_DIR, { recursive: true, mode: 0o700 });
  hardenDirectory(CACHE_DIR);
  hardenDirectory(ENTRY_DIR);

  const filename = entryFilename(key);
  const temporary = path.join(
    ENTRY_DIR,
    `.${path.basename(filename)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, JSON.stringify({ key, ...entry }), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    hardenFile(temporary);
    try {
      // A hard link publishes the fully-written inode only if the destination
      // is still absent. Unlike rename, it cannot overwrite a concurrent set.
      fs.linkSync(temporary, filename);
      hardenFile(filename);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  } finally {
    removeFile(temporary);
  }
}

function maybePruneEntries(now = Date.now()): void {
  try {
    if (fs.existsSync(GC_MARKER_FILE)) {
      hardenFile(GC_MARKER_FILE);
      if (now - fs.statSync(GC_MARKER_FILE).mtimeMs < GC_INTERVAL_MS) return;
    }

    if (fs.existsSync(ENTRY_DIR)) {
      for (const filename of fs.readdirSync(ENTRY_DIR)) {
        const fullPath = path.join(ENTRY_DIR, filename);
        if (ENTRY_FILE_PATTERN.test(filename)) {
          const entry = loadEntryFile(fullPath);
          if (!entry || !isFresh(entry, now)) removeFile(fullPath);
        } else if (
          TEMP_FILE_PATTERN.test(filename) &&
          now - fs.statSync(fullPath).mtimeMs >= ABANDONED_TEMP_MS
        ) {
          removeFile(fullPath);
        }
      }
    }
    fs.writeFileSync(GC_MARKER_FILE, String(now), { mode: 0o600 });
    hardenFile(GC_MARKER_FILE);
  } catch {
    // Cache garbage collection is best effort.
  }
}

export function makeKey(command: string, query: string, location: number, language: string): string {
  return `${command}:${location}:${language}:${query.toLowerCase()}`;
}

export function get<T = unknown>(key: string): T | null {
  const filename = entryFilename(key);
  const entry = loadEntryFile(filename, key);
  if (entry) {
    if (isFresh(entry)) return entry.data as T;
    removeFile(filename);
  }

  const legacy = loadLegacy()[key];
  return legacy && isFresh(legacy) ? legacy.data as T : null;
}

export function set(key: string, data: unknown): void {
  try {
    saveEntry(key, { data, ts: Date.now() });
    maybePruneEntries();
  } catch {
    // Cache write failure is non-fatal and must not hide a paid API result.
  }
}

export function printCache(): void {
  const store = loadAll();
  const now = Date.now();
  const entries = Object.entries(store).filter(
    ([, value]) => isCacheEntry(value) && isFresh(value, now),
  );

  if (entries.length === 0) {
    console.log("Cache is empty.");
    return;
  }

  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const [command] = entry[0].split(":");
    if (!groups.has(command)) groups.set(command, []);
    groups.get(command)!.push(entry);
  }

  console.log(`Cached entries: ${entries.length}\n`);

  for (const [command, group] of groups) {
    console.log(`[${escapeTsvCell(command)}] (${group.length} entries)`);
    for (const [key, entry] of group) {
      const daysAgo = Math.floor((now - entry.ts) / (24 * 60 * 60 * 1000));
      const [, location, language, ...queryParts] = key.split(":");
      const query = queryParts.join(":");

      if (command.startsWith("volume")) {
        const data =
          typeof entry.data === "object" && entry.data !== null
            ? entry.data as Record<string, unknown>
            : {};
        console.log(
          `  "${escapeTsvCell(data.keyword)}" vol=${escapeTsvCell(data.volume)} cpc=${escapeTsvCell(data.cpc)} diff=${escapeTsvCell(data.difficulty ?? "?")} | loc=${escapeTsvCell(location)} lang=${escapeTsvCell(language)} | ${daysAgo}d ago`,
        );
      } else {
        const items = Array.isArray(entry.data) ? entry.data : [];
        console.log(`  "${escapeTsvCell(query)}" | loc=${escapeTsvCell(location)} lang=${escapeTsvCell(language)} | ${daysAgo}d ago`);
        for (const item of items) {
          const candidate =
            typeof item === "object" && item !== null
              ? item as Record<string, unknown>
              : {};
          const keyword = candidate.keyword || "?";
          const volume = candidate.volume ?? "?";
          const difficulty = candidate.difficulty ?? "?";
          console.log(`    ${escapeTsvCell(keyword)} (vol=${escapeTsvCell(volume)}, diff=${escapeTsvCell(difficulty)})`);
        }
      }
    }
    console.log();
  }
}
