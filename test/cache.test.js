const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { execFile, execFileSync } = require("node:child_process");
const {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const projectRoot = join(__dirname, "..");
const cacheModule = join(projectRoot, "dist/cache.js");
const execFileAsync = promisify(execFile);

function child(script, home) {
  return execFileSync(process.execPath, ["-e", script], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

function childAsync(script, home) {
  return execFileAsync(process.execPath, ["-e", script], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

test("cache writes atomic per-key entries with private permissions", () => {
  if (process.platform === "win32") return;
  const home = mkdtempSync(join(tmpdir(), "dataforseo-cache-test-"));
  try {
    child(
      `const c=require(${JSON.stringify(cacheModule)}); c.set('volume-v2:2840:en:secret query',{keyword:'secret query'})`,
      home,
    );
    const directory = join(home, ".cache", "dataforseo-cli");
    const entriesDirectory = join(directory, "entries");
    const filenames = readdirSync(entriesDirectory).filter((name) => name.endsWith(".json"));

    assert.equal(filenames.length, 1);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(entriesDirectory).mode & 0o777, 0o700);
    const filename = join(entriesDirectory, filenames[0]);
    assert.equal(statSync(filename).mode & 0o777, 0o600);
    assert.match(readFileSync(filename, "utf8"), /secret query/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("legacy cache is permission-hardened, migrated, and pruned", () => {
  if (process.platform === "win32") return;
  const home = mkdtempSync(join(tmpdir(), "dataforseo-cache-legacy-"));
  try {
    const directory = join(home, ".cache", "dataforseo-cli");
    const legacyFile = join(directory, "cache.json");
    mkdirSync(directory, { recursive: true, mode: 0o755 });
    writeFileSync(legacyFile, JSON.stringify({
      legacy: { data: { answer: 42 }, ts: Date.now() },
      expired: { data: { answer: 0 }, ts: 0 },
    }), { mode: 0o644 });
    chmodSync(directory, 0o755);
    chmodSync(legacyFile, 0o644);

    const rendered = child(
      `const c=require(${JSON.stringify(cacheModule)}); process.stdout.write(JSON.stringify(c.get('legacy')))`,
      home,
    );
    assert.deepEqual(JSON.parse(rendered), { answer: 42 });
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(existsSync(legacyFile), false);

    const entriesDirectory = join(directory, "entries");
    const files = readdirSync(entriesDirectory).map((name) => join(entriesDirectory, name));
    assert.equal(files.length, 1);
    assert.equal(statSync(entriesDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(files[0]).mode & 0o777, 0o600);
    assert.match(readFileSync(files[0], "utf8"), /"legacy"/);
    assert.doesNotMatch(readFileSync(files[0], "utf8"), /"expired"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("legacy migration cannot overwrite a concurrent same-key write", () => {
  const home = mkdtempSync(join(tmpdir(), "dataforseo-cache-race-"));
  try {
    const key = "target";
    const directory = join(home, ".cache", "dataforseo-cli");
    const entriesDirectory = join(directory, "entries");
    const legacyFile = join(directory, "cache.json");
    const digest = createHash("sha256").update(key).digest("hex");
    const destination = join(entriesDirectory, `${digest}.json`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(legacyFile, JSON.stringify({
      [key]: { data: { marker: "legacy" }, ts: Date.now() },
    }));

    const rendered = child(
      `const fs=require('node:fs'); const original=fs.linkSync; const destination=${JSON.stringify(destination)}; const key=${JSON.stringify(key)}; let injected=false; fs.linkSync=(source,target)=>{if(!injected&&target===destination){injected=true; fs.writeFileSync(destination,JSON.stringify({key,data:{marker:'new'},ts:Date.now()+1}),{mode:0o600})} return original(source,target)}; const c=require(${JSON.stringify(cacheModule)}); c.get(key); process.stdout.write(JSON.stringify(c.get(key)))`,
      home,
    );

    assert.deepEqual(JSON.parse(rendered), { marker: "new" });
    assert.equal(existsSync(legacyFile), false);
    assert.match(readFileSync(destination, "utf8"), /"new"/);
    assert.doesNotMatch(readFileSync(destination, "utf8"), /"legacy"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("parallel agent writers do not lose unrelated cache entries", async () => {
  const home = mkdtempSync(join(tmpdir(), "dataforseo-cache-parallel-"));
  const count = 24;
  try {
    await Promise.all(Array.from({ length: count }, (_, index) => childAsync(
      `const c=require(${JSON.stringify(cacheModule)}); c.set('parallel:${index}',{index:${index}})`,
      home,
    )));

    const entriesDirectory = join(home, ".cache", "dataforseo-cli", "entries");
    assert.equal(
      readdirSync(entriesDirectory).filter((name) => name.endsWith(".json")).length,
      count,
    );
    const rendered = child(
      `const c=require(${JSON.stringify(cacheModule)}); process.stdout.write(JSON.stringify(Array.from({length:${count}},(_,i)=>c.get('parallel:'+i))))`,
      home,
    );
    assert.deepEqual(
      JSON.parse(rendered),
      Array.from({ length: count }, (_, index) => ({ index })),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("cache inspection escapes terminal-active cached values", () => {
  const home = mkdtempSync(join(tmpdir(), "dataforseo-cache-output-"));
  try {
    child(
      `const c=require(${JSON.stringify(cacheModule)}); c.set('related:2840:en:query\\u001b\\u202e',[{keyword:'result\\u0007\\u202e',volume:1,difficulty:2}])`,
      home,
    );
    const rendered = child(
      `const c=require(${JSON.stringify(cacheModule)}); c.printCache()`,
      home,
    );
    assert.equal(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(rendered), false);
    assert.match(rendered, /query\\u001B\\u202E/);
    assert.match(rendered, /result\\u0007\\u202E/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a new-key write garbage-collects expired entries", () => {
  const home = mkdtempSync(join(tmpdir(), "dataforseo-cache-expired-"));
  try {
    const key = "expired-entry";
    const directory = join(home, ".cache", "dataforseo-cli", "entries");
    const digest = createHash("sha256").update(key).digest("hex");
    const filename = join(directory, `${digest}.json`);
    const malformed = join(directory, `${"0".repeat(64)}.json`);
    const abandoned = join(directory, `.${"1".repeat(64)}.json.999.deadbeef.tmp`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(filename, JSON.stringify({ key, data: "stale", ts: 0 }));
    writeFileSync(malformed, "not-json");
    writeFileSync(abandoned, "partial-write");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(abandoned, old, old);

    child(
      `const c=require(${JSON.stringify(cacheModule)}); c.set('different-new-key',{fresh:true})`,
      home,
    );
    assert.equal(existsSync(filename), false);
    assert.equal(existsSync(malformed), false);
    assert.equal(existsSync(abandoned), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
