export type OutputFormat = "tsv" | "json" | "jsonl" | "table";

type Row = Record<string, unknown>;

const CELL_UNSAFE_CHARACTER =
  /[\\\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const JSON_UNSAFE_CHARACTER =
  /[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function unicodeEscape(character: string): string {
  return `\\u${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
}

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Convert a value into a single lossless cell. Structured values stay valid,
 * compact JSON instead of degrading to "[object Object]".
 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;

  if (typeof value === "object") {
    const json = JSON.stringify(value);
    return json === undefined ? "" : json;
  }

  return String(value);
}

/**
 * Escape delimiters and terminal-active characters without conflating them
 * with a literal escape sequence already present in the source value.
 */
export function escapeTsvCell(value: unknown): string {
  return formatCell(value).replace(CELL_UNSAFE_CHARACTER, (character) => {
    switch (character) {
      case "\\":
        return "\\\\";
      case "\t":
        return "\\t";
      case "\r":
        return "\\r";
      case "\n":
        return "\\n";
      default:
        return unicodeEscape(character);
    }
  });
}

/** Return every key in first-seen order, rather than only keys from row one. */
export function unionKeys(data: readonly object[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];

  for (const row of data) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }

  return keys;
}

export function formatTable(
  data: readonly object[],
  explicitKeys?: readonly string[],
): string {
  const keys = explicitKeys ? [...explicitKeys] : unionKeys(data);
  if (keys.length === 0) return "";

  const escapedKeys = keys.map(escapeTsvCell);

  const cells = data.map((row) =>
    keys.map((key) => escapeTsvCell((row as Row)[key])),
  );
  const widths = escapedKeys.map((key, index) =>
    Math.max(key.length, ...cells.map((row) => row[index].length)),
  );

  const header = escapedKeys
    .map((key, index) => key.padEnd(widths[index]))
    .join("  ");
  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  const rows = cells.map((row) =>
    row.map((cell, index) => cell.padEnd(widths[index])).join("  "),
  );

  return [header, separator, ...rows].join("\n");
}

export function formatTsv(
  data: readonly object[],
  explicitKeys?: readonly string[],
): string {
  const keys = explicitKeys ? [...explicitKeys] : unionKeys(data);
  if (keys.length === 0) return "";

  const header = keys.map(escapeTsvCell).join("\t");
  const rows = data.map((row) =>
    keys.map((key) => escapeTsvCell((row as Row)[key])).join("\t"),
  );

  return [header, ...rows].join("\n");
}

export function formatJson(data: unknown): string {
  const json = JSON.stringify(data);
  if (json === undefined) return "null";

  // JSON.stringify already escapes C0 characters. Escape the remaining
  // terminal-active characters while retaining valid, lossless JSON.
  return json.replace(JSON_UNSAFE_CHARACTER, unicodeEscape);
}

export function formatJsonl(data: unknown): string {
  const values = Array.isArray(data) ? data : [data];
  return values.map(formatJson).join("\n");
}

export function getFormat(opts: {
  json?: boolean;
  jsonl?: boolean;
  table?: boolean;
  human?: boolean;
  tsv?: boolean;
}): OutputFormat {
  if (opts.jsonl) return "jsonl";
  if (opts.json) return "json";
  if (opts.table || opts.human) return "table";
  return "tsv";
}

export function output(data: object[], format: OutputFormat): string {
  switch (format) {
    case "json":
      return formatJson(data);
    case "jsonl":
      return formatJsonl(data);
    case "table":
      return formatTable(data);
    case "tsv":
      return formatTsv(data);
  }
}

export { isRecord };
