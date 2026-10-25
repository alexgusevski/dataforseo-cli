const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AgentOutputError,
  parseFieldProjection,
  prepareAgentOutput,
  projectFields,
  projectionTarget,
  renderAgentOutput,
  selectByPath,
} = require("../dist/agent-output.js");

test("default generic output is lossless compact one-line JSON", () => {
  const data = {
    id: "task-1",
    status_code: 20000,
    result: [{ items: [{ keyword: "seo tools", metrics: { volume: 1200 } }] }],
  };

  const rendered = renderAgentOutput(data);
  assert.equal(rendered, JSON.stringify(data));
  assert.equal(rendered.includes("\n"), false);
});

test("selectByPath resolves objects, array indexes, and an optional leading dot", () => {
  const data = { tasks: [{ result: [{ items: ["first"] }] }] };
  assert.equal(selectByPath(data, "tasks.0.result.0.items.0"), "first");
  assert.deepEqual(selectByPath(data, ".tasks.0"), data.tasks[0]);
});

test("selectByPath reports missing and malformed paths", () => {
  assert.throws(
    () => selectByPath({ result: {} }, "result.items"),
    (error) => error instanceof AgentOutputError && error.message === "Path not found: result.items",
  );
  assert.throws(() => selectByPath({}, "result..items"), /Invalid dot path/);
  assert.throws(() => selectByPath({}, ""), /cannot be empty/);
});

test("parseFieldProjection preserves aliases and requested order", () => {
  assert.deepEqual(
    parseFieldProjection("kw=keyword, volume=keyword_info.search_volume,rank"),
    [
      { alias: "kw", path: "keyword" },
      { alias: "volume", path: "keyword_info.search_volume" },
      { alias: "rank", path: "rank" },
    ],
  );
});

test("parseFieldProjection rejects projections that would lose columns", () => {
  assert.throws(() => parseFieldProjection(""), /at least one field/);
  assert.throws(() => parseFieldProjection("keyword,"), /empty field/);
  assert.throws(() => parseFieldProjection("=keyword"), /Invalid field projection/);
  assert.throws(() => parseFieldProjection("x=keyword,x=url"), /Duplicate field alias/);
});

test("field projection automatically targets direct DataForSEO items", () => {
  const result = {
    id: "task-1",
    status_code: 20000,
    status_message: "Ok.",
    items: [
      { keyword: "alpha", keyword_info: { search_volume: 10 } },
      { keyword: "beta", keyword_info: { search_volume: 20 } },
    ],
  };

  assert.equal(projectionTarget(result), result.items);
  assert.deepEqual(
    projectFields(result, "kw=keyword,sv=keyword_info.search_volume"),
    [{ kw: "alpha", sv: 10 }, { kw: "beta", sv: 20 }],
  );
});

test("field projection unwraps a singleton DataForSEO result container", () => {
  const compactTaskResult = [{
    seed_keyword: "seo",
    total_count: 2,
    items: [{ keyword: "alpha", rank: 1 }, { keyword: "beta", rank: 2 }],
  }];

  assert.equal(projectionTarget(compactTaskResult), compactTaskResult[0].items);
  assert.deepEqual(projectFields(compactTaskResult, "keyword,position=rank"), [
    { keyword: "alpha", position: 1 },
    { keyword: "beta", position: 2 },
  ]);
});

test("field projection automatically targets the common .ai.items shape", () => {
  const response = {
    api: "dataforseo_labs/google/keyword_suggestions/live",
    ai: {
      id: "task-2",
      status_code: 20000,
      status_message: "Ok.",
      items: [{ keyword: "gamma", rank: 3 }, { keyword: "delta" }],
    },
  };

  assert.equal(projectionTarget(response), response.ai.items);
  assert.deepEqual(projectFields(response, "keyword,pos=rank"), [
    { keyword: "gamma", pos: 3 },
    { keyword: "delta", pos: null },
  ]);
});

test("field projection flattens items across compact and full batch task responses", () => {
  const tasks = [
    {
      id: "one",
      status_code: 20000,
      result: [{ items: [{ keyword: "alpha", volume: 10 }] }],
    },
    {
      id: "two",
      status_code: 20000,
      result: [{ items: [{ keyword: "beta", volume: 20 }] }],
    },
  ];
  const expected = [
    { keyword: "alpha", volume: 10 },
    { keyword: "beta", volume: 20 },
  ];
  assert.deepEqual(projectFields(tasks, "keyword,volume"), expected);
  assert.deepEqual(projectFields({ status_code: 20000, tasks }, "keyword,volume"), expected);
});

test("select is applied before fields", () => {
  const data = {
    payload: {
      items: [{ keyword: "selected", nested: { score: 0.9 } }],
    },
    items: [{ keyword: "wrong" }],
  };

  assert.deepEqual(
    prepareAgentOutput(data, {
      select: "payload",
      fields: "keyword,score=nested.score",
    }),
    [{ keyword: "selected", score: 0.9 }],
  );
});

test("JSONL emits one complete JSON value per projected row", () => {
  const data = { items: [{ keyword: "one" }, { keyword: "two" }] };
  assert.equal(
    renderAgentOutput(data, { format: "jsonl", fields: "keyword" }),
    '{"keyword":"one"}\n{"keyword":"two"}',
  );
});

test("TSV projection uses aliases as headers and emits a header for empty items", () => {
  const data = { ai: { id: "task", status_code: 20000, status_message: "Ok", items: [] } };
  assert.equal(
    renderAgentOutput(data, { format: "tsv", fields: "kw=keyword,sv=search_volume" }),
    "kw\tsv",
  );
});

test("tabular scalar and nested selected output remains data-only", () => {
  assert.equal(
    renderAgentOutput({ answer: "yes" }, { format: "tsv", select: "answer" }),
    "value\nyes",
  );
  assert.equal(
    renderAgentOutput({ row: { nested: { ok: true } } }, { format: "tsv", select: "row" }),
    'nested\n{"ok":true}',
  );
});

test("projection safely preserves unusual aliases", () => {
  const rendered = renderAgentOutput(
    { items: [{ keyword: "safe" }] },
    { fields: "__proto__=keyword,constructor=keyword" },
  );
  assert.equal(rendered, '[{"__proto__":"safe","constructor":"safe"}]');
});
