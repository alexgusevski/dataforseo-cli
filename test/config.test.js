const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

const projectRoot = join(__dirname, "..");
const configModule = join(projectRoot, "dist/config.js");

function child(script, env = {}) {
  return execFileSync(process.execPath, ["-e", script], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("environment credentials support ephemeral agents and preserve punctuation", () => {
  const output = child(
    `const c=require(${JSON.stringify(configModule)}); process.stdout.write(JSON.stringify(c.getApiKey()))`,
    {
      DATAFORSEO_LOGIN: "agent@example.com",
      DATAFORSEO_PASSWORD: "part=one:part=two",
    },
  );
  assert.deepEqual(JSON.parse(output), {
    login: "agent@example.com",
    password: "part=one:part=two",
  });
});

test("stored credential files are private and base64 padding is preserved", () => {
  const home = mkdtempSync(join(tmpdir(), "dataforseo-config-test-"));
  try {
    const token = Buffer.from("agent@example.com:password==").toString("base64");
    child(
      `const c=require(${JSON.stringify(configModule)}); c.setCredentials(undefined,undefined,${JSON.stringify(token)})`,
      {
        HOME: home,
        DATAFORSEO_LOGIN: "",
        DATAFORSEO_PASSWORD: "",
        DATAFORSEO_AUTH: "",
      },
    );
    const filename = join(home, ".config", "dataforseo-cli", "config.json");
    assert.deepEqual(JSON.parse(readFileSync(filename, "utf8")), {
      login: "agent@example.com",
      password: "password==",
    });
    if (process.platform !== "win32") {
      assert.equal(statSync(join(home, ".config", "dataforseo-cli")).mode & 0o777, 0o700);
      assert.equal(statSync(filename).mode & 0o777, 0o600);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("reading a legacy credential file repairs permissive modes", () => {
  if (process.platform === "win32") return;
  const home = mkdtempSync(join(tmpdir(), "dataforseo-config-legacy-test-"));
  try {
    const directory = join(home, ".config", "dataforseo-cli");
    const filename = join(directory, "config.json");
    mkdirSync(directory, { recursive: true, mode: 0o755 });
    writeFileSync(filename, JSON.stringify({ login: "legacy", password: "secret" }), {
      mode: 0o644,
    });
    chmodSync(directory, 0o755);
    chmodSync(filename, 0o644);

    const result = JSON.parse(
      child(
        `const c=require(${JSON.stringify(configModule)}); process.stdout.write(JSON.stringify(c.getApiKey()))`,
        {
          HOME: home,
          DATAFORSEO_LOGIN: "",
          DATAFORSEO_PASSWORD: "",
          DATAFORSEO_AUTH: "",
        },
      ),
    );
    assert.deepEqual(result, { login: "legacy", password: "secret" });
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(filename).mode & 0o777, 0o600);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an interrupted atomic credential replacement preserves the old file", () => {
  const home = mkdtempSync(join(tmpdir(), "dataforseo-config-atomic-test-"));
  try {
    const directory = join(home, ".config", "dataforseo-cli");
    const filename = join(directory, "config.json");
    mkdirSync(directory, { recursive: true });
    writeFileSync(filename, JSON.stringify({ login: "old", password: "old-secret" }));

    const result = JSON.parse(child(
      `const fs=require('node:fs'); const c=require(${JSON.stringify(configModule)}); fs.renameSync=()=>{throw new Error('simulated interruption')}; let failed=false; try{c.setCredentials('new','new-secret')}catch{failed=true} process.stdout.write(JSON.stringify({failed,stored:JSON.parse(fs.readFileSync(${JSON.stringify(filename)},'utf8'))}))`,
      {
        HOME: home,
        DATAFORSEO_LOGIN: "",
        DATAFORSEO_PASSWORD: "",
        DATAFORSEO_AUTH: "",
      },
    ));

    assert.equal(result.failed, true);
    assert.deepEqual(result.stored, { login: "old", password: "old-secret" });
    assert.deepEqual(readdirSync(directory), ["config.json"]);
    if (process.platform !== "win32") {
      assert.equal(statSync(filename).mode & 0o777, 0o600);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
