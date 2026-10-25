import { promises as fs } from "fs";

export type StdinSource =
  | string
  | Buffer
  | NodeJS.ReadableStream
  | AsyncIterable<string | Buffer | Uint8Array>
  | (() => string | Buffer | Promise<string | Buffer>);

function defineOwn(
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  // Assignment to `__proto__` on a normal object has legacy setter behavior.
  // Defining fields explicitly keeps arbitrary valid JSON keys as plain data.
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function parseJsonDocument(text: string, source: string): unknown {
  if (!text.trim()) throw new Error(`${source} is empty; expected JSON`);
  try {
    // A UTF-8 BOM is common in files copied from desktop editors.
    return JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
  } catch (cause) {
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    throw new Error(`Invalid JSON in ${source}${detail}`, { cause });
  }
}

async function readStream(source: NodeJS.ReadableStream | AsyncIterable<unknown>) {
  const chunks: Buffer[] = [];
  for await (const chunk of source as AsyncIterable<unknown>) {
    if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
    else if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
    else throw new Error("stdin produced a non-text chunk");
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readExplicitStdin(source?: StdinSource): Promise<string> {
  const selected = source ?? process.stdin;
  if (typeof selected === "string") return selected;
  if (Buffer.isBuffer(selected)) return selected.toString("utf8");
  if (typeof selected === "function") {
    const value = await selected();
    return Buffer.isBuffer(value) ? value.toString("utf8") : value;
  }
  return readStream(selected);
}

/**
 * Parse a `--data` value. Stdin is touched only for the explicit value `-`;
 * omitted data never consumes a pipeline accidentally.
 */
export async function readDataArgument(
  value: string | undefined,
  stdin?: StdinSource
): Promise<unknown | undefined> {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError("--data must be an inline JSON string, @file, or -");
  }

  if (value === "-") {
    const text = await readExplicitStdin(stdin);
    return parseJsonDocument(text, "stdin");
  }

  if (value.startsWith("@")) {
    const filename = value.slice(1);
    if (!filename) throw new Error("--data @file requires a file path");
    let text: string;
    try {
      text = await fs.readFile(filename, "utf8");
    } catch (cause) {
      throw new Error(`Unable to read JSON data file \"${filename}\"`, { cause });
    }
    return parseJsonDocument(text, `data file \"${filename}\"`);
  }

  return parseJsonDocument(value, "--data");
}

export interface ParsedFieldAssignments {
  [key: string]: unknown;
}

/** Parse agent-friendly `key=value` and typed `key:=JSON` assignments. */
export function parseFieldAssignments(
  assignments: readonly string[] = []
): ParsedFieldAssignments {
  if (!Array.isArray(assignments)) {
    throw new TypeError("Field assignments must be an array");
  }

  const fields: ParsedFieldAssignments = {};
  const seen = new Set<string>();

  for (const assignment of assignments) {
    if (typeof assignment !== "string") {
      throw new TypeError("Every field assignment must be a string");
    }

    const equalsIndex = assignment.indexOf("=");
    if (equalsIndex < 1) {
      throw new Error(
        `Invalid field assignment \"${assignment}\"; use key=value or key:=JSON`
      );
    }

    const typed = assignment[equalsIndex - 1] === ":";
    const key = assignment.slice(0, typed ? equalsIndex - 1 : equalsIndex);
    const rawValue = assignment.slice(equalsIndex + 1);
    if (!key || !/^[A-Za-z_][A-Za-z\d_.-]*$/.test(key)) {
      throw new Error(`Invalid field name \"${key}\"`);
    }
    if (seen.has(key)) {
      throw new Error(`Duplicate field \"${key}\"`);
    }
    seen.add(key);

    const value = typed
      ? parseJsonDocument(rawValue, `typed field \"${key}\"`)
      : rawValue;
    defineOwn(fields, key, value);
  }

  return fields;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Select either `--data` or positional fields, reject ambiguous merges, and
 * optionally turn a single JSON task object into DataForSEO's task array.
 */
export function prepareRequestBody(
  data: unknown | undefined,
  fields: Readonly<Record<string, unknown>> = {},
  wrapObjectAsTaskArray = false
): unknown | undefined {
  if (!isRecord(fields)) throw new TypeError("Parsed fields must be an object");
  const fieldNames = Object.keys(fields);
  if (data !== undefined && fieldNames.length > 0) {
    throw new Error("Use either --data or positional fields, not both");
  }

  let body: unknown;
  if (data !== undefined) {
    body = data;
  } else if (fieldNames.length > 0) {
    body = {};
    for (const key of fieldNames) {
      defineOwn(body as Record<string, unknown>, key, fields[key]);
    }
  } else {
    return undefined;
  }

  if (wrapObjectAsTaskArray && isRecord(body)) return [body];
  return body;
}

export const parseAssignments = parseFieldAssignments;
