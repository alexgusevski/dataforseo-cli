const test = require("node:test");
const assert = require("node:assert/strict");

const {
  escapeTsvCell,
  formatJson,
  formatJsonl,
  formatTable,
  formatTsv,
  unionKeys,
} = require("../dist/formatters.js");

test("TSV uses the union of row keys in first-seen order", () => {
  const rows = [{ keyword: "one", volume: 10 }, { keyword: "two", url: "/two" }];
  assert.deepEqual(unionKeys(rows), ["keyword", "volume", "url"]);
  assert.equal(
    formatTsv(rows),
    "keyword\tvolume\turl\none\t10\t\ntwo\t\t/two",
  );
});

test("TSV escapes delimiters, line breaks, carriage returns, and backslashes", () => {
  assert.equal(escapeTsvCell("a\\b\tc\rd\ne"), "a\\\\b\\tc\\rd\\ne");
  assert.equal(
    formatTsv([{ value: "a\\b\tc\rd\ne" }]),
    "value\na\\\\b\\tc\\rd\\ne",
  );
});

test("TSV and table output escape terminal and bidirectional controls", () => {
  const unsafe = "\x00\x07\x1b\x7f\x85\u061c\u200e\u200f\u202e\u2066";
  const escaped =
    "\\u0000\\u0007\\u001B\\u007F\\u0085\\u061C\\u200E\\u200F\\u202E\\u2066";
  // Tabs/newlines are the intentional TSV/table separators; every other
  // terminal-active code point must be represented as plain ASCII.
  const rawUnsafe = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

  assert.equal(escapeTsvCell(unsafe), escaped);
  assert.equal(escapeTsvCell("\x1b\\u001B"), "\\u001B\\\\u001B");

  const tsv = formatTsv([{ ["key\u202e"]: unsafe }]);
  const table = formatTable([{ ["key\u202e"]: unsafe }]);
  assert.equal(rawUnsafe.test(tsv), false);
  assert.equal(rawUnsafe.test(table), false);
  assert.match(tsv, /key\\u202E/);
  assert.match(table, /\\u001B/);
});

test("nested values are serialized as compact JSON and never object coercions", () => {
  const rendered = formatTsv([{
    object: { volume: 42 },
    list: ["a", "b"],
  }]);

  assert.equal(rendered, 'object\tlist\n{"volume":42}\t["a","b"]');
  assert.equal(rendered.includes("[object Object]"), false);
});

test("empty TSV with explicit fields prints its header", () => {
  assert.equal(formatTsv([], ["keyword", "volume"]), "keyword\tvolume");
  assert.equal(formatTsv([]), "");
});

test("table uses all columns and does not truncate values", () => {
  const rendered = formatTable([
    { keyword: "one" },
    { keyword: "two", details: { complete: true } },
  ]);
  assert.match(rendered, /^keyword  details/m);
  assert.match(rendered, /\{"complete":true\}/);
});

test("JSONL emits arrays as records and objects as one complete line", () => {
  assert.equal(formatJsonl([{ a: 1 }, { a: 2 }]), '{"a":1}\n{"a":2}');
  assert.equal(formatJsonl({ nested: { a: 1 } }), '{"nested":{"a":1}}');
  assert.equal(formatJsonl([]), "");
});

test("JSON and JSONL safely escape C1 and bidirectional controls losslessly", () => {
  const text = "safe\x7f\x85\u061c\u200e\u200f\u202a\u202e\u2066\u2069";
  const value = { ["key\u202e"]: text, c0: "\x1b" };
  const rawUnsafe = /[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

  const json = formatJson(value);
  assert.equal(rawUnsafe.test(json), false);
  assert.match(json, /\\u007F/);
  assert.match(json, /\\u0085/);
  assert.match(json, /\\u061C/);
  assert.match(json, /\\u202E/);
  assert.match(json, /\\u2069/);
  assert.deepEqual(JSON.parse(json), value);

  const jsonl = formatJsonl([value, { text }]);
  assert.equal(rawUnsafe.test(jsonl), false);
  assert.deepEqual(jsonl.split("\n").map(JSON.parse), [value, { text }]);
});
