const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  DataForSeoRequestError,
  appendAiSuffix,
  buildApiUrl,
  compactDataForSeoResponse,
  executeApiRequest,
  getFailedTasks,
  hasTaskErrors,
  isDataForSeoSuccessCode,
  isDataForSeoResultCode,
  normalizeApiPath,
  substitutePathParams,
} = require("../dist/transport.js");
const {
  parseFieldAssignments,
  prepareRequestBody,
  readDataArgument,
} = require("../dist/call-input.js");

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

test("normalizes only safe DataForSEO-relative paths", () => {
  assert.equal(normalizeApiPath("serp/google/organic/live/advanced"), "/v3/serp/google/organic/live/advanced");
  assert.equal(normalizeApiPath("/serp/google/organic/live/advanced/"), "/v3/serp/google/organic/live/advanced");
  assert.equal(normalizeApiPath("v3/serp/google/organic/live/advanced"), "/v3/serp/google/organic/live/advanced");
  assert.equal(normalizeApiPath("/v3/serp/google/organic/live/advanced"), "/v3/serp/google/organic/live/advanced");

  for (const unsafe of [
    "https://attacker.example/steal",
    "//attacker.example/steal",
    "../account",
    "foo/../account",
    "foo/%2e%2e/account",
    "foo/%252e%252e/account",
    "foo#fragment",
    "foo?secret=yes",
    "foo\\bar",
  ]) {
    assert.throws(() => normalizeApiPath(unsafe), { message: /path|query|fragment|URL|traversal/i });
  }
});

test("substitutes encoded path parameters and returns unused fields", () => {
  const result = substitutePathParams("/v3/serp/task_get/{id}/{label}", {
    id: "abc/123",
    label: "two words!",
    limit: 10,
  });
  assert.equal(result.path, "/v3/serp/task_get/abc%2F123/two%20words%21");
  assert.deepEqual(result.remaining, { limit: 10 });
  assert.equal(
    substitutePathParams("/v3/merchant/google/sellers/ad_url/{shop_ad_aclk}", {
      shop_ad_aclk: "discount 50%",
    }).path,
    "/v3/merchant/google/sellers/ad_url/discount%2050%25"
  );
  assert.throws(
    () => substitutePathParams("/v3/tasks/{id}", {}),
    /Missing path parameter "id"/
  );
  assert.throws(
    () => substitutePathParams("/v3/tasks/{id}", { id: "../account" }),
    /traversal/
  );
});

test("appends .ai only after a path is concrete", () => {
  assert.equal(
    appendAiSuffix("/v3/serp/google/organic/live/advanced"),
    "/v3/serp/google/organic/live/advanced.ai"
  );
  assert.equal(appendAiSuffix("serp/live.ai"), "/v3/serp/live.ai");
  assert.throws(() => appendAiSuffix("tasks/{id}"), /Substitute path parameters/);
});

test("builds encoded query parameters without changing origin", () => {
  const url = buildApiUrl("/v3/example", {
    tag: ["one two", "three"],
    limit: 10,
    exact: false,
    omitted: undefined,
  });
  assert.equal(url.origin, "https://api.dataforseo.com");
  assert.equal(url.pathname, "/v3/example");
  assert.deepEqual(url.searchParams.getAll("tag"), ["one two", "three"]);
  assert.equal(url.searchParams.get("limit"), "10");
  assert.equal(url.searchParams.get("exact"), "false");
  assert.equal(url.searchParams.has("omitted"), false);
  assert.throws(() => buildApiUrl("example", { nested: { unsafe: true } }), /must be a scalar/);
});

test("parses string and typed positional fields and rejects duplicates", () => {
  const fields = parseFieldAssignments([
    "keyword=coffee=beans",
    "limit:=25",
    "enabled:=true",
    "filters:=[\"volume\",\">\",100]",
    "metadata:={\"source\":\"agent\"}",
    "empty=",
  ]);
  assert.deepEqual(fields, {
    keyword: "coffee=beans",
    limit: 25,
    enabled: true,
    filters: ["volume", ">", 100],
    metadata: { source: "agent" },
    empty: "",
  });
  assert.throws(() => parseFieldAssignments(["limit=10", "limit:=20"]), /Duplicate field/);
  assert.throws(() => parseFieldAssignments(["limit:=nope"]), /Invalid JSON/);
  assert.throws(() => parseFieldAssignments(["not-an-assignment"]), /key=value/);
});

test("reads --data inline, from @file, and from explicit stdin only", async () => {
  assert.deepEqual(await readDataArgument('{"keyword":"seo"}'), { keyword: "seo" });
  assert.deepEqual(await readDataArgument("-", async () => '[{"limit":5}]'), [{ limit: 5 }]);

  let stdinRead = false;
  assert.equal(
    await readDataArgument(undefined, () => {
      stdinRead = true;
      return "{}";
    }),
    undefined
  );
  assert.equal(stdinRead, false);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dataforseo-cli-test-"));
  try {
    const filename = path.join(tempDir, "body.json");
    await fs.writeFile(filename, "\uFEFF{\"target\":\"example.com\"}", "utf8");
    assert.deepEqual(await readDataArgument(`@${filename}`), { target: "example.com" });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("prepares one unambiguous request body and optionally wraps task objects", () => {
  assert.deepEqual(prepareRequestBody(undefined, { keyword: "seo", limit: 10 }, true), [
    { keyword: "seo", limit: 10 },
  ]);
  assert.deepEqual(prepareRequestBody([{ keyword: "seo" }], {}, true), [
    { keyword: "seo" },
  ]);
  assert.equal(prepareRequestBody(undefined, {}, true), undefined);
  assert.throws(
    () => prepareRequestBody({ keyword: "seo" }, { limit: 10 }, true),
    /either --data or positional fields/
  );
});

test("executes one explicit request with auth, JSON body, query, and no retry", async () => {
  const calls = [];
  const envelope = {
    status_code: 20000,
    status_message: "Ok.",
    tasks: [{ id: "task-1", status_code: 20100, status_message: "Task Created.", cost: 0.01, result: null }],
  };
  const result = await executeApiRequest({
    method: "post",
    path: "serp/google/organic/task_post",
    query: { priority: 1 },
    body: [{ keyword: "coffee" }],
    authHeader: "Basic injected",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(envelope);
    },
  });

  assert.deepEqual(result, envelope);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.href, "https://api.dataforseo.com/v3/serp/google/organic/task_post?priority=1");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Basic injected");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, '[{"keyword":"coffee"}]');
  assert.equal(calls[0].init.redirect, "error");
});

test("accepts every 2xxxx DataForSEO status, including 20100", async () => {
  assert.equal(isDataForSeoSuccessCode(20000), true);
  assert.equal(isDataForSeoSuccessCode(20100), true);
  assert.equal(isDataForSeoSuccessCode(29999), true);
  assert.equal(isDataForSeoSuccessCode(30000), false);

  const response = await executeApiRequest({
    method: "POST",
    path: "/v3/tasks",
    authHeader: "Basic injected",
    fetchImpl: async () => jsonResponse({ status_code: 20100, status_message: "Task Created." }),
  });
  assert.equal(response.status_code, 20100);
});

test("returns partial and queued result states instead of discarding their payload", async () => {
  for (const statusCode of [40106, 40601, 40602]) {
    assert.equal(isDataForSeoResultCode(statusCode), true);
    const payload = {
      status_code: statusCode,
      status_message: "Nonterminal or partial task state",
      items: statusCode === 40106 ? [{ rank: 1 }] : [],
    };
    const result = await executeApiRequest({
      method: "GET",
      path: "/v3/example.ai",
      authHeader: "Basic injected",
      fetchImpl: async () => jsonResponse(payload),
    });
    assert.deepEqual(result, payload);
    assert.equal(hasTaskErrors(result), true);
  }
});

test("returns flattened .ai task errors while standard API errors still throw", async () => {
  const flattenedTaskError = {
    id: "failed-ai-task",
    status_code: 40501,
    status_message: "Invalid Field",
    data: { keyword: "" },
    items: [],
  };
  const result = await executeApiRequest({
    method: "POST",
    path: "/v3/serp/google/organic/live/advanced.ai",
    authHeader: "Basic injected",
    fetchImpl: async () => jsonResponse(flattenedTaskError),
  });
  assert.deepEqual(result, flattenedTaskError);
  assert.deepEqual(getFailedTasks(result), [flattenedTaskError]);

  await assert.rejects(
    executeApiRequest({
      method: "POST",
      path: "/v3/serp/google/organic/live/advanced",
      authHeader: "Basic injected",
      fetchImpl: async () => jsonResponse(flattenedTaskError),
    }),
    (error) => error instanceof DataForSeoRequestError && error.kind === "api"
  );

  await assert.rejects(
    executeApiRequest({
      method: "POST",
      path: "/v3/serp/google/organic/live/advanced.ai",
      authHeader: "Basic injected",
      fetchImpl: async () => jsonResponse({
        status_code: 40501,
        status_message: "Request-level failure",
      }),
    }),
    (error) => error instanceof DataForSeoRequestError && error.kind === "api"
  );
});

test("compacts single results and task posts without losing task identifiers", () => {
  assert.deepEqual(
    compactDataForSeoResponse({
      status_code: 20000,
      cost: 0.1,
      tasks: [{ id: "live-1", status_code: 20000, status_message: "Ok.", cost: 0.1, result: [{ items: [1, 2] }] }],
    }),
    [{ items: [1, 2] }]
  );
  assert.deepEqual(
    compactDataForSeoResponse({
      status_code: 20000,
      cost: 0.01,
      tasks: [{ id: "post-1", status_code: 20100, status_message: "Task Created.", result: null, time: "1 sec" }],
    }),
    { id: "post-1", status_code: 20100, status_message: "Task Created.", cost: 0.01 }
  );
});

test("compaction retains a top-level error and its task details", () => {
  assert.deepEqual(
    compactDataForSeoResponse({
      version: "0.1",
      status_code: 40501,
      status_message: "Invalid request",
      cost: 0,
      tasks: [
        {
          id: "bad",
          status_code: 40501,
          status_message: "Invalid field",
          cost: 0,
          result: null,
          data: { keyword: "" },
        },
      ],
    }),
    {
      status_code: 40501,
      status_message: "Invalid request",
      cost: 0,
      tasks: [
        {
          id: "bad",
          status_code: 40501,
          status_message: "Invalid field",
          cost: 0,
          result: null,
          data: { keyword: "" },
        },
      ],
    }
  );
});

test("keeps all tasks and exposes mixed task errors", () => {
  const envelope = {
    status_code: 20000,
    tasks_error: 1,
    tasks: [
      { id: "ok", status_code: 20000, status_message: "Ok.", cost: 0.02, result: [{ keyword: "seo" }], time: "1" },
      { id: "bad", status_code: 40501, status_message: "Invalid field", cost: 0, result: null, data: { keyword: "" } },
    ],
  };
  assert.equal(hasTaskErrors(envelope), true);
  assert.equal(getFailedTasks(envelope)[0].id, "bad");
  const compact = compactDataForSeoResponse(envelope);
  assert.deepEqual(compact, [
    { id: "ok", status_code: 20000, status_message: "Ok.", cost: 0.02, result: [{ keyword: "seo" }] },
    { id: "bad", status_code: 40501, status_message: "Invalid field", cost: 0, result: null, data: { keyword: "" } },
  ]);
  assert.equal(hasTaskErrors(compact), true);
});

test("throws structured API and HTTP errors while preserving response data", async () => {
  const apiError = {
    status_code: 40501,
    status_message: "Invalid Field",
    tasks: [{ id: "bad", status_code: 40501, result: null }],
  };
  await assert.rejects(
    executeApiRequest({
      method: "POST",
      path: "/v3/example",
      authHeader: "Basic injected",
      fetchImpl: async () => jsonResponse(apiError),
    }),
    (error) => {
      assert.equal(error instanceof DataForSeoRequestError, true);
      assert.equal(error.kind, "api");
      assert.equal(error.statusCode, 40501);
      assert.deepEqual(error.data, apiError);
      assert.deepEqual(error.toJSON().data.tasks, apiError.tasks);
      return true;
    }
  );

  await assert.rejects(
    executeApiRequest({
      method: "GET",
      path: "/v3/example",
      authHeader: "Basic injected",
      fetchImpl: async () => new Response("upstream unavailable", {
        status: 503,
        headers: { "content-type": "text/plain" },
      }),
    }),
    (error) => {
      assert.equal(error.kind, "http");
      assert.equal(error.httpStatus, 503);
      assert.equal(error.data, "upstream unavailable");
      return true;
    }
  );
});

test("preserves successful non-JSON text responses", async () => {
  const result = await executeApiRequest({
    method: "GET",
    path: "/v3/plain",
    authHeader: "Basic injected",
    fetchImpl: async () => new Response("plain response", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
  });
  assert.equal(result, "plain response");
});

test("aborts once at the configured timeout and never retries", async () => {
  let calls = 0;
  await assert.rejects(
    executeApiRequest({
      method: "POST",
      path: "/v3/slow",
      timeoutMs: 5,
      authHeader: "Basic injected",
      fetchImpl: async (_url, init) => {
        calls += 1;
        await new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    }),
    (error) => error instanceof DataForSeoRequestError && error.kind === "timeout"
  );
  assert.equal(calls, 1);
});

test("timeout remains active while the response body is being consumed", async () => {
  let calls = 0;
  await assert.rejects(
    executeApiRequest({
      method: "GET",
      path: "/v3/slow-body",
      timeoutMs: 5,
      authHeader: "Basic injected",
      fetchImpl: async (_url, init) => {
        calls += 1;
        const body = new ReadableStream({
          start(controller) {
            init.signal.addEventListener(
              "abort",
              () => controller.error(new Error("body aborted")),
              { once: true }
            );
          },
        });
        return new Response(body, { headers: { "content-type": "application/json" } });
      },
    }),
    (error) => error instanceof DataForSeoRequestError && error.kind === "timeout"
  );
  assert.equal(calls, 1);
});
