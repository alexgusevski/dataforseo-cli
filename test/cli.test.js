const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { join } = require("node:path");
const test = require("node:test");

const projectRoot = join(__dirname, "..");
const cli = join(projectRoot, "dist/index.js");
const preload = join(__dirname, "fetch-mock.cjs");
const packageVersion = require("../package.json").version;

function run(args, options = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      DATAFORSEO_LOGIN: "agent@example.com",
      DATAFORSEO_PASSWORD: "secret",
      NODE_OPTIONS: `--require=${preload}`,
      ...options.env,
    },
  });
}

test("top-level help advertises the three-step full API workflow", () => {
  const help = run(["--help"]);
  assert.match(help, /endpoints \[options\]/);
  assert.match(help, /describe \[options\]/);
  assert.match(help, /api\|call \[options\]/);
  assert.match(help, /Catalog: 570 operations/);
});

test("CLI and package versions stay in sync", () => {
  assert.equal(run(["--version"]).trim(), packageVersion);
});

test("endpoint discovery and describe work offline without credentials", () => {
  const env = { DATAFORSEO_LOGIN: "", DATAFORSEO_PASSWORD: "" };
  const families = run(["endpoints"], { env });
  assert.match(families, /^family\toperations/m);
  assert.match(families, /^serp\t181$/m);

  const matches = run(["endpoints", "keyword", "suggestions", "--limit", "2"], { env });
  assert.match(matches, /GoogleKeywordSuggestionsLive/);

  const description = run(["describe", "GoogleKeywordSuggestionsLive"], { env });
  assert.match(description, /^endpoint\tPOST\t\/v3\/dataforseo_labs/m);
  assert.match(description, /^field\trequired\tkeyword:string$/m);
  assert.match(description, /^example\t\{"keyword":"phone"/m);
  assert.match(description, /^docs\thttps:\/\/docs\.dataforseo\.com\/.+\.md$/m);
});

test("universal api call wraps task input, uses .ai, and projects compact output", () => {
  const result = JSON.parse(
    run([
      "api",
      "GoogleOrganicLiveAdvanced",
      "keyword=seo tools",
      "location_code:=2840",
      "--fields",
      "href,method,body",
      "--format",
      "json",
    ]),
  );

  assert.equal(result.length, 1);
  assert.match(result[0].href, /\/v3\/serp\/google\/organic\/live\/advanced\.ai$/);
  assert.equal(result[0].method, "POST");
  assert.deepEqual(result[0].body, [{ keyword: "seo tools", location_code: 2840 }]);
});

test("case-insensitive endpoint matching sends canonical API path casing", () => {
  const response = JSON.parse(run([
    "api",
    "/V3/SERP/GOOGLE/ORGANIC/LIVE/ADVANCED",
    "keyword=seo",
  ]));
  assert.equal(
    new URL(response.items[0].href).pathname,
    "/v3/serp/google/organic/live/advanced.ai",
  );
});

test("--full disables .ai and preserves the complete response envelope", () => {
  const result = JSON.parse(
    run([
      "api",
      "GoogleOrganicLiveAdvanced",
      "keyword=seo",
      "--full",
    ]),
  );
  assert.equal(result.version, "0.1");
  assert.equal(result.tasks[0].id, "full-task");
  assert.doesNotMatch(result.tasks[0].result[0].items[0].href, /\.ai$/);
});

test("-X consistently overrides the method for unique operation IDs and paths", () => {
  for (const endpoint of [
    "GoogleOrganicLiveAdvanced",
    "/v3/serp/google/organic/live/advanced",
  ]) {
    const result = JSON.parse(run(["api", endpoint, "-X", "GET", "keyword=seo"]));
    assert.equal(result.items[0].method, "GET");
    assert.equal(result.items[0].body, null);
    assert.match(result.items[0].href, /advanced\.ai\?keyword=seo$/);
  }
});

test("task creation preserves its ID and every successful 2xxxx status", () => {
  const result = JSON.parse(
    run([
      "api",
      "GoogleOrganicTaskPost",
      "keyword=seo",
      "location_code:=2840",
      "language_code=en",
    ]),
  );
  assert.deepEqual(result, {
    id: "created-task",
    status_code: 20100,
    status_message: "Task Created.",
    cost: 0.01,
  });
});

test("uncatalogued --data remains exact while positional POST fields use task sugar", () => {
  const exact = JSON.parse(
    run(["api", "/v3/future/object_endpoint", "-X", "POST", "--data", '{"target":"example.com"}']),
  );
  assert.deepEqual(exact[0].items[0].body, { target: "example.com" });

  const positional = JSON.parse(
    run(["api", "/v3/future/task_endpoint", "-X", "POST", "target=example.com"]),
  );
  assert.deepEqual(positional[0].items[0].body, [{ target: "example.com" }]);
});

test("usage failures are compact and nonzero", () => {
  const result = spawnSync(
    process.execPath,
    [cli, "api", "GoogleOrganicLiveAdvanced"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DATAFORSEO_LOGIN: "agent@example.com",
        DATAFORSEO_PASSWORD: "secret",
        NODE_OPTIONS: `--require=${preload}`,
      },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /POST endpoint requires a body/);
  assert.equal(result.stdout, "");
});

test("invalid output options fail before a potentially billable request", () => {
  for (const [args, expected] of [
    [["--format", "xml"], /--format must be/],
    [["--fields", "href,,title"], /--fields contains an empty field/],
    [["--select", "tasks..result"], /Invalid dot path/],
  ]) {
    const result = spawnSync(
      process.execPath,
      [cli, "api", "GoogleOrganicLiveAdvanced", "keyword=seo", ...args],
      {
        cwd: projectRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          DATAFORSEO_LOGIN: "agent@example.com",
          DATAFORSEO_PASSWORD: "secret",
          NODE_OPTIONS: `--require=${preload}`,
          FAIL_ON_FETCH: "1",
        },
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stderr, /FETCH_CALLED/);
    assert.equal(result.stdout, "");
  }
});

test("invalid location limits fail before the authenticated lookup", () => {
  const result = spawnSync(
    process.execPath,
    [cli, "locations", "sweden", "--limit", "nope"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DATAFORSEO_LOGIN: "agent@example.com",
        DATAFORSEO_PASSWORD: "secret",
        NODE_OPTIONS: `--require=${preload}`,
        FAIL_ON_FETCH: "1",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--limit must be a positive integer/);
  assert.doesNotMatch(result.stderr, /FETCH_CALLED/);
});

test("fixed-arity commands reject excess arguments before any API call", () => {
  for (const args of [
    ["status", "extra"],
    ["describe", "GoogleOrganicLiveAdvanced", "extra"],
    ["related", "seo", "tools"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DATAFORSEO_LOGIN: "agent@example.com",
        DATAFORSEO_PASSWORD: "secret",
        NODE_OPTIONS: `--require=${preload}`,
        FAIL_ON_FETCH: "1",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /too many arguments/);
    assert.doesNotMatch(result.stderr, /FETCH_CALLED/);
  }
});

test("legacy global switches are recognized only in leading global position", () => {
  const afterDelimiter = spawnSync(
    process.execPath,
    [cli, "endpoints", "--", "--print-cache"],
    { cwd: projectRoot, encoding: "utf8", env: process.env },
  );
  assert.equal(afterDelimiter.status, 0);
  assert.doesNotMatch(afterDelimiter.stdout, /Cache is empty|Cached entries/);

  const help = spawnSync(process.execPath, [cli, "--help", "--print-cache"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
  });
  assert.match(help.stdout, /Usage: dataforseo-cli/);
  assert.doesNotMatch(help.stdout, /Cache is empty|Cached entries/);
});

test("invalid stored-credential fields never echo their values", () => {
  const secret = "DO_NOT_ECHO_THIS_SECRET";
  const result = spawnSync(
    process.execPath,
    [cli, "--set-credentials", `passwrod=${secret}`],
    { cwd: projectRoot, encoding: "utf8", env: process.env },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid credential field "passwrod"/);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});

test("structured request failures retain DataForSEO task diagnostics", () => {
  const result = spawnSync(
    process.execPath,
    [cli, "api", "GoogleOrganicLiveAdvanced", "keyword=", "--no-ai"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DATAFORSEO_LOGIN: "agent@example.com",
        DATAFORSEO_PASSWORD: "secret",
        NODE_OPTIONS: `--require=${preload}`,
        MOCK_API_ERROR: "1",
      },
    },
  );
  assert.equal(result.status, 1);
  const error = JSON.parse(result.stderr);
  assert.equal(error.kind, "api");
  assert.equal(error.data.tasks[0].id, "bad-task");
  assert.equal(error.data.tasks[0].status_message, "Field-specific validation failed.");
});

test("oversized request failures stay valid, terminal-safe, and bounded", () => {
  const result = spawnSync(
    process.execPath,
    [cli, "api", "GoogleOrganicLiveAdvanced", "keyword=bad", "--no-ai"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DATAFORSEO_LOGIN: "agent@example.com",
        DATAFORSEO_PASSWORD: "secret",
        NODE_OPTIONS: `--require=${preload}`,
        MOCK_HUGE_API_ERROR: "1",
      },
    },
  );
  assert.equal(result.status, 1);
  assert.ok(Buffer.byteLength(result.stderr, "utf8") <= 32 * 1024 + 1);
  assert.equal(result.stderr.includes("\u001b"), false);
  assert.equal(result.stderr.includes("\u202e"), false);
  const error = JSON.parse(result.stderr);
  assert.equal(error.kind, "api");
  assert.equal(error.statusCode, 40501);
  assert.equal(error.data_truncated, true);
});

test("empty JSONL results emit zero records and no blank line", () => {
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "api",
      "GoogleOrganicLiveAdvanced",
      "keyword=unlikely",
      "--fields",
      "keyword",
      "--format",
      "jsonl",
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DATAFORSEO_LOGIN: "agent@example.com",
        DATAFORSEO_PASSWORD: "secret",
        NODE_OPTIONS: `--require=${preload}`,
        MOCK_EMPTY_AI: "1",
      },
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("partial task output is preserved with a warning and exit code 2", () => {
  const result = spawnSync(
    process.execPath,
    [cli, "api", "GoogleOrganicLiveAdvanced", "keyword=partial"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DATAFORSEO_LOGIN: "agent@example.com",
        DATAFORSEO_PASSWORD: "secret",
        NODE_OPTIONS: `--require=${preload}`,
        MOCK_AI_PARTIAL: "1",
      },
    },
  );
  assert.equal(result.status, 2);
  assert.equal(result.stdout.includes("\u001b"), false);
  assert.equal(result.stdout.includes("\u202e"), false);
  assert.equal(result.stderr.includes("\u001b"), false);
  assert.equal(result.stderr.includes("\u202e"), false);
  const output = JSON.parse(result.stdout);
  assert.equal(output.id, "partial-task");
  assert.equal(output.items[0].keyword, "partial result");
  const warning = JSON.parse(result.stderr);
  assert.equal(warning.tasks[0].status_code, 40106);
});
