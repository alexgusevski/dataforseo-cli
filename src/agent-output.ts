import {
  formatJson,
  formatJsonl,
  formatTable,
  formatTsv,
  isRecord,
  type OutputFormat,
} from "./formatters";

export type AgentOutputFormat = OutputFormat;

export interface AgentOutputOptions {
  /** Compact JSON is the intentionally lossless default for generic results. */
  format?: AgentOutputFormat;
  /** Select a value before applying a field projection. */
  select?: string;
  /** Comma-separated `path` or `alias=path` projection fields. */
  fields?: string;
}

export interface ProjectionField {
  alias: string;
  path: string;
}

export class AgentOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentOutputError";
  }
}

function pathParts(path: string): string[] {
  const normalized = path.trim().replace(/^\./, "");
  if (!normalized) {
    throw new AgentOutputError("A dot path cannot be empty");
  }

  const parts = normalized.split(".");
  if (parts.some((part) => part.length === 0)) {
    throw new AgentOutputError(`Invalid dot path: ${path}`);
  }

  return parts;
}

/** Validate dot-path syntax without needing (or fetching) response data. */
export function validateDotPath(path: string): void {
  pathParts(path);
}

/** Resolve an own-property dot path. Numeric segments address array elements. */
export function selectByPath(value: unknown, path: string): unknown {
  let current = value;

  for (const part of pathParts(path)) {
    if (
      (typeof current !== "object" || current === null) ||
      !Object.prototype.hasOwnProperty.call(current, part)
    ) {
      throw new AgentOutputError(`Path not found: ${path}`);
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

export function parseFieldProjection(fields: string): ProjectionField[] {
  if (!fields.trim()) {
    throw new AgentOutputError("--fields requires at least one field");
  }

  const parsed = fields.split(",").map((rawField) => {
    const field = rawField.trim();
    if (!field) {
      throw new AgentOutputError("--fields contains an empty field");
    }

    const equalsAt = field.indexOf("=");
    const alias = (equalsAt === -1 ? field : field.slice(0, equalsAt)).trim();
    const path = (equalsAt === -1 ? field : field.slice(equalsAt + 1)).trim();

    if (!alias || !path) {
      throw new AgentOutputError(`Invalid field projection: ${field}`);
    }
    pathParts(path);
    return { alias, path };
  });

  const aliases = new Set<string>();
  for (const field of parsed) {
    if (aliases.has(field.alias)) {
      throw new AgentOutputError(`Duplicate field alias: ${field.alias}`);
    }
    aliases.add(field.alias);
  }

  return parsed;
}

function trySelectByPath(value: unknown, path: string): unknown {
  try {
    return selectByPath(value, path);
  } catch (error) {
    if (error instanceof AgentOutputError && error.message.startsWith("Path not found:")) {
      return null;
    }
    throw error;
  }
}

function projectRecord(
  value: unknown,
  fields: readonly ProjectionField[],
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    Object.defineProperty(projected, field.alias, {
      value: trySelectByPath(value, field.path),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return projected;
}

/**
 * Locate the row collection used by DataForSEO's compact `.ai` result and by
 * directly selected result objects. This deliberately recognizes only these
 * shapes; it never recursively guesses and discards unrelated metadata.
 */
export function projectionTarget(value: unknown): unknown {
  if (isRecord(value) && Array.isArray(value.tasks)) {
    const rows = projectionRowsFromTasks(value.tasks);
    if (rows !== undefined) return rows;
  }

  // A successful single DataForSEO task commonly compacts to its `result`,
  // whose usual shape is a one-element array containing the actual items.
  if (Array.isArray(value)) {
    const taskRows = projectionRowsFromTasks(value);
    if (taskRows !== undefined) return taskRows;
    if (
      value.length === 1 &&
      isRecord(value[0]) &&
      Array.isArray(value[0].items)
    ) {
      return value[0].items;
    }
    return value;
  }
  if (!isRecord(value)) return value;

  if (Array.isArray(value.items)) return value.items;

  if (isRecord(value.ai) && Array.isArray(value.ai.items)) {
    return value.ai.items;
  }

  return value;
}

function projectionRowsFromTasks(tasks: readonly unknown[]): unknown[] | undefined {
  if (
    tasks.length === 0 ||
    !tasks.every(
      (task) =>
        isRecord(task) &&
        typeof task.status_code === "number" &&
        Object.prototype.hasOwnProperty.call(task, "result"),
    )
  ) {
    return undefined;
  }

  const rows: unknown[] = [];
  let hasResult = false;
  for (const task of tasks) {
    const result = (task as Record<string, unknown>).result;
    if (result === null || result === undefined) continue;
    hasResult = true;

    const values = Array.isArray(result) ? result : [result];
    for (const value of values) {
      if (isRecord(value) && Array.isArray(value.items)) rows.push(...value.items);
      else rows.push(value);
    }
  }
  return hasResult ? rows : undefined;
}

export function projectFields(
  value: unknown,
  fields: string | readonly ProjectionField[],
): Record<string, unknown> | Record<string, unknown>[] {
  const parsed = typeof fields === "string" ? parseFieldProjection(fields) : fields;
  const target = projectionTarget(value);

  if (Array.isArray(target)) {
    return target.map((item) => projectRecord(item, parsed));
  }

  return projectRecord(target, parsed);
}

export function prepareAgentOutput(
  data: unknown,
  options: Pick<AgentOutputOptions, "select" | "fields"> = {},
): unknown {
  const selected = options.select !== undefined
    ? selectByPath(data, options.select)
    : data;
  return options.fields !== undefined
    ? projectFields(selected, options.fields)
    : selected;
}

function rowsForTabularOutput(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map((item) => isRecord(item) ? item : { value: item });
  }
  return [isRecord(value) ? value : { value }];
}

/** Render data only; callers decide where and whether to print it. */
export function renderAgentOutput(
  data: unknown,
  options: AgentOutputOptions = {},
): string {
  const prepared = prepareAgentOutput(data, options);
  const format = options.format ?? "json";

  switch (format) {
    case "json":
      return formatJson(prepared);
    case "jsonl":
      return formatJsonl(prepared);
    case "tsv": {
      const headers = options.fields !== undefined
        ? parseFieldProjection(options.fields).map((field) => field.alias)
        : undefined;
      return formatTsv(rowsForTabularOutput(prepared), headers);
    }
    case "table": {
      const headers = options.fields !== undefined
        ? parseFieldProjection(options.fields).map((field) => field.alias)
        : undefined;
      return formatTable(rowsForTabularOutput(prepared), headers);
    }
  }
}
