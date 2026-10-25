import { getAuthHeader } from "./config";

export const DATAFORSEO_API_ORIGIN = "https://api.dataforseo.com";
export const DATAFORSEO_API_BASE_URL = `${DATAFORSEO_API_ORIGIN}/v3`;
export const DEFAULT_TIMEOUT_MS = 180_000;

export type QueryPrimitive = string | number | boolean | null | undefined;
export type QueryValue = QueryPrimitive | readonly QueryPrimitive[];
export type QueryParameters =
  // `unknown` keeps parsed positional fields composable with this API; values
  // are validated as scalar (or scalar arrays) before the request is built.
  | Readonly<Record<string, unknown>>
  | URLSearchParams;

export interface ExecuteApiRequestOptions {
  /** HTTP method is deliberately required; the transport never guesses it. */
  method: string;
  /** A catalog path such as `serp/google/organic/live/advanced` or `/v3/...`. */
  path: string;
  body?: unknown;
  query?: QueryParameters;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Useful for callers with an already resolved credential and for tests. */
  authHeader?: string | (() => string);
}

export type DataForSeoErrorKind =
  | "http"
  | "api"
  | "timeout"
  | "network"
  | "response";

export interface DataForSeoErrorDetails {
  kind: DataForSeoErrorKind;
  message: string;
  httpStatus?: number;
  httpStatusText?: string;
  statusCode?: number;
  statusMessage?: string;
  contentType?: string;
  data?: unknown;
}

/**
 * A serializable error which keeps the server payload intact. In particular,
 * callers can print successful and failed task IDs/results from a mixed batch.
 */
export class DataForSeoRequestError extends Error {
  readonly kind: DataForSeoErrorKind;
  readonly httpStatus?: number;
  readonly httpStatusText?: string;
  readonly statusCode?: number;
  readonly statusMessage?: string;
  readonly contentType?: string;
  readonly data?: unknown;

  constructor(details: DataForSeoErrorDetails, cause?: unknown) {
    super(details.message, cause === undefined ? undefined : { cause });
    this.name = "DataForSeoRequestError";
    this.kind = details.kind;
    this.httpStatus = details.httpStatus;
    this.httpStatusText = details.httpStatusText;
    this.statusCode = details.statusCode;
    this.statusMessage = details.statusMessage;
    this.contentType = details.contentType;
    this.data = details.data;
  }

  toJSON(): DataForSeoErrorDetails & { error: string } {
    const serialized: DataForSeoErrorDetails & { error: string } = {
      error: this.name,
      kind: this.kind,
      message: this.message,
    };
    if (this.httpStatus !== undefined) serialized.httpStatus = this.httpStatus;
    if (this.httpStatusText !== undefined) {
      serialized.httpStatusText = this.httpStatusText;
    }
    if (this.statusCode !== undefined) serialized.statusCode = this.statusCode;
    if (this.statusMessage !== undefined) {
      serialized.statusMessage = this.statusMessage;
    }
    if (this.contentType !== undefined) serialized.contentType = this.contentType;
    if (this.data !== undefined) serialized.data = this.data;
    return serialized;
  }
}

// Preserve both common spellings for consumers without duplicating a class.
export { DataForSeoRequestError as DataForSEORequestError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function defineOwn(
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function repeatedlyDecode(segment: string): string {
  let decoded = segment;
  let decodedAtLeastOnce = false;
  // A small fixed bound catches encoded and double-encoded dot traversal while
  // avoiding an attacker-controlled decode loop.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch (error) {
      // An encoded path parameter containing a literal percent sign becomes
      // `%25`, then `%` after one security decode. That second form is safe and
      // is still sent as the original `%25`. A malformed raw segment remains
      // an error because no successful decode preceded it.
      if (decodedAtLeastOnce) return decoded;
      throw error;
    }
    if (next === decoded) return decoded;
    decodedAtLeastOnce = true;
    decoded = next;
  }
  return decoded;
}

function assertSafePathSegment(segment: string): void {
  if (!segment) throw new Error("API path cannot contain empty segments");

  let decoded: string;
  try {
    decoded = repeatedlyDecode(segment);
  } catch {
    throw new Error(`API path contains invalid percent encoding: ${segment}`);
  }

  if (/\p{Cc}/u.test(decoded)) {
    throw new Error("API path cannot contain control characters");
  }

  // Check separators after decoding too. This catches `%2e%2e`,
  // `%252e%252e`, and encoded forms such as `..%2fsecret`.
  const decodedParts = decoded.replace(/\\/g, "/").split("/");
  if (decodedParts.some((part) => part === "." || part === "..")) {
    throw new Error("API path traversal is not allowed");
  }
}

/**
 * Canonicalize an API-relative path to `/v3/...` without ever accepting an
 * origin supplied by the caller. Query strings belong in `query` and are
 * intentionally rejected here.
 */
export function normalizeApiPath(input: string): string {
  if (typeof input !== "string") throw new TypeError("API path must be a string");

  let path = input.trim();
  if (!path) throw new Error("API path is required");
  if (/\s/.test(path)) {
    throw new Error("API path cannot contain unescaped whitespace");
  }
  if (path.includes("\\")) throw new Error("API path cannot contain backslashes");
  if (path.includes("#")) throw new Error("API path fragments are not allowed");
  if (path.includes("?")) {
    throw new Error("Put query parameters in the query option, not in the API path");
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//")) {
    throw new Error("API path must be relative; absolute URLs are not allowed");
  }

  // Accept all ergonomic forms: `foo`, `/foo`, `v3/foo`, and `/v3/foo`.
  if (path.startsWith("/")) path = path.slice(1);
  if (path === "v3") return "/v3";
  if (path.startsWith("v3/")) path = path.slice(3);

  // A trailing slash adds no endpoint information and makes `.ai` suffixing
  // surprising, so canonical paths omit it.
  path = path.replace(/\/+$/, "");
  if (!path) return "/v3";

  const segments = path.split("/");
  for (const segment of segments) assertSafePathSegment(segment);
  return `/v3/${segments.join("/")}`;
}

function encodePathParameter(value: unknown, name: string): string {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean" &&
    typeof value !== "bigint"
  ) {
    throw new Error(`Path parameter \"${name}\" must be a scalar value`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Path parameter \"${name}\" must be finite`);
  }

  // encodeURIComponent leaves a few punctuation characters untouched. Encode
  // those too so substituted values are unambiguously one RFC 3986 segment.
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export interface SubstitutedPath {
  path: string;
  remaining: Record<string, unknown>;
}

/** Replace `{name}` placeholders and return unused values for body/query use. */
export function substitutePathParams(
  template: string,
  values: Readonly<Record<string, unknown>> = {}
): SubstitutedPath {
  if (!isRecord(values)) throw new TypeError("Path values must be an object");

  const placeholderPattern = /\{([^{}]+)\}/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = placeholderPattern.exec(template)) !== null) {
    if (!match[1]) throw new Error("API path contains an empty placeholder");
    names.push(match[1]);
  }
  if (/[{}]/.test(template.replace(placeholderPattern, ""))) {
    throw new Error("API path contains a malformed placeholder");
  }

  const consumed = new Set<string>();
  const substituted = template.replace(placeholderPattern, (_whole, name: string) => {
    if (!hasOwn(values, name) || values[name] === undefined) {
      throw new Error(`Missing path parameter \"${name}\"`);
    }
    consumed.add(name);
    return encodePathParameter(values[name], name);
  });

  const remaining: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!consumed.has(key)) defineOwn(remaining, key, value);
  }

  return { path: normalizeApiPath(substituted), remaining };
}

/** Append DataForSEO's AI-optimized response suffix to a concrete path. */
export function appendAiSuffix(input: string): string {
  const path = normalizeApiPath(input);
  if (/[{}]/.test(path)) {
    throw new Error("Substitute path parameters before appending .ai");
  }
  return path.endsWith(".ai") ? path : `${path}.ai`;
}

function appendQueryValue(url: URL, key: string, value: QueryPrimitive): void {
  if (value === undefined) return;
  if (!key) throw new Error("Query parameter names cannot be empty");
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    throw new Error(`Query parameter \"${key}\" must be a scalar or scalar array`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Query parameter \"${key}\" must be finite`);
  }
  url.searchParams.append(key, value === null ? "null" : String(value));
}

export function buildApiUrl(path: string, query?: QueryParameters): URL {
  const normalizedPath = normalizeApiPath(path);
  if (/[{}]/.test(normalizedPath)) {
    throw new Error("API path still contains an unresolved placeholder");
  }

  const url = new URL(normalizedPath, DATAFORSEO_API_ORIGIN);
  if (url.origin !== DATAFORSEO_API_ORIGIN) {
    // This should be unreachable after normalization, but keep the invariant
    // beside the actual credential-bearing request.
    throw new Error("Refusing to send credentials outside api.dataforseo.com");
  }

  if (query instanceof URLSearchParams) {
    query.forEach((value, key) => appendQueryValue(url, key, value));
  } else if (query !== undefined) {
    if (!isRecord(query)) throw new TypeError("Query parameters must be an object");
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) {
        for (const item of value) appendQueryValue(url, key, item);
      } else {
        appendQueryValue(url, key, value as QueryPrimitive);
      }
    }
  }

  return url;
}

export function isDataForSeoSuccessCode(code: unknown): code is number {
  return (
    typeof code === "number" &&
    Number.isInteger(code) &&
    code >= 20_000 &&
    code < 30_000
  );
}

/**
 * These non-2xxxx task states can carry useful results or polling state and
 * must reach the caller instead of being collapsed into a transport error.
 */
export function isDataForSeoResultCode(code: unknown): code is number {
  return (
    isDataForSeoSuccessCode(code) ||
    code === 40_106 || // completed with partial results
    code === 40_601 || // task handed
    code === 40_602 // task in queue
  );
}

// Acronym-preserving alias for discoverability.
export const isDataForSEOSuccessCode = isDataForSeoSuccessCode;

function extractMessage(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  for (const key of ["status_message", "message", "error"] as const) {
    if (typeof data[key] === "string" && data[key]) return data[key];
  }
  return undefined;
}

function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function isFlattenedAiTaskResponse(data: unknown, url: URL): boolean {
  return (
    url.pathname.toLowerCase().endsWith(".ai") &&
    isRecord(data) &&
    hasOwn(data, "id") &&
    hasOwn(data, "status_code")
  );
}

async function parseResponseBody(
  response: Response,
  contentType: string
): Promise<unknown> {
  const text = await response.text();
  if (!isJsonContentType(contentType)) return text;
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new DataForSeoRequestError(
      {
        kind: "response",
        message: `DataForSEO returned invalid JSON (HTTP ${response.status})`,
        httpStatus: response.status,
        httpStatusText: response.statusText,
        contentType,
        data: text,
      },
      cause
    );
  }
}

/**
 * Execute exactly one request. There are intentionally no retry paths here:
 * many DataForSEO POSTs are billable and not safely repeatable.
 */
export async function executeApiRequest(
  options: ExecuteApiRequestOptions
): Promise<unknown> {
  if (!options || typeof options !== "object") {
    throw new TypeError("Request options are required");
  }

  const method = options.method?.trim().toUpperCase();
  if (!method || !/^[!#$%&'*+.^_`|~A-Z\d-]+$/.test(method)) {
    throw new Error("An explicit valid HTTP method is required");
  }

  const url = buildApiUrl(options.path, options.query);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive finite number");
  }

  const authorization =
    typeof options.authHeader === "function"
      ? options.authHeader()
      : options.authHeader ?? getAuthHeader();
  if (typeof authorization !== "string" || !authorization) {
    throw new Error("A non-empty authorization header is required");
  }

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    Authorization: authorization,
  };
  let serializedBody: string | undefined;
  if (options.body !== undefined) {
    serializedBody = JSON.stringify(options.body);
    if (serializedBody === undefined) {
      throw new Error("Request body is not JSON-serializable");
    }
    headers["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    clearTimeout(timer);
    throw new Error("No fetch implementation is available");
  }

  let response: Response;
  let contentType = "";
  let data: unknown;
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body: serializedBody,
      signal: controller.signal,
      // Never follow a redirect with a credential-bearing request.
      redirect: "error",
    });
    // Keep the same deadline active while consuming the body. Receiving
    // headers alone does not mean a request has completed.
    contentType = response.headers.get("content-type") ?? "";
    data = await parseResponseBody(response, contentType);
  } catch (cause) {
    if (timedOut || controller.signal.aborted) {
      throw new DataForSeoRequestError(
        {
          kind: "timeout",
          message: `DataForSEO request timed out after ${timeoutMs}ms`,
        },
        cause
      );
    }
    if (cause instanceof DataForSeoRequestError) throw cause;
    throw new DataForSeoRequestError(
      { kind: "network", message: "DataForSEO request failed" },
      cause
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = extractMessage(data);
    throw new DataForSeoRequestError({
      kind: "http",
      message: detail
        ? `DataForSEO HTTP ${response.status}: ${detail}`
        : `DataForSEO HTTP ${response.status}${
            response.statusText ? `: ${response.statusText}` : ""
          }`,
      httpStatus: response.status,
      httpStatusText: response.statusText,
      contentType,
      data,
    });
  }

  if (isRecord(data) && hasOwn(data, "status_code")) {
    const statusCode = data.status_code;
    if (
      typeof statusCode === "number" &&
      !isDataForSeoResultCode(statusCode) &&
      !isFlattenedAiTaskResponse(data, url)
    ) {
      const statusMessage =
        typeof data.status_message === "string" ? data.status_message : undefined;
      throw new DataForSeoRequestError({
        kind: "api",
        message: statusMessage
          ? `DataForSEO API ${statusCode}: ${statusMessage}`
          : `DataForSEO API error ${statusCode}`,
        httpStatus: response.status,
        httpStatusText: response.statusText,
        statusCode,
        statusMessage,
        contentType,
        data,
      });
    }
  }

  return data;
}

export const requestDataForSeo = executeApiRequest;
export const requestDataForSEO = executeApiRequest;

export function getFailedTasks(data: unknown): Record<string, unknown>[] {
  const candidates = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.tasks)
      ? data.tasks
      : isRecord(data)
        ? [data]
        : [];
  return candidates.filter(
    (task): task is Record<string, unknown> =>
      isRecord(task) &&
      typeof task.status_code === "number" &&
      !isDataForSeoSuccessCode(task.status_code)
  );
}

export const getTaskErrors = getFailedTasks;

export function hasTaskErrors(data: unknown): boolean {
  return getFailedTasks(data).length > 0;
}

function copyTaskField(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string
): void {
  if (hasOwn(source, key) && source[key] !== undefined) {
    defineOwn(target, key, source[key]);
  }
}

function compactTask(
  task: unknown,
  includeResult: boolean,
  includeErrorData: boolean,
  fallbackCost?: unknown
): unknown {
  if (!isRecord(task)) return task;
  const compact: Record<string, unknown> = {};
  for (const key of ["id", "status_code", "status_message", "cost"]) {
    copyTaskField(task, compact, key);
  }
  if (!hasOwn(compact, "cost") && fallbackCost !== undefined) {
    defineOwn(compact, "cost", fallbackCost);
  }
  if (includeResult && hasOwn(task, "result")) {
    defineOwn(compact, "result", task.result);
  }
  if (
    includeErrorData &&
    !isDataForSeoSuccessCode(task.status_code) &&
    hasOwn(task, "data")
  ) {
    defineOwn(compact, "data", task.data);
  }
  return Object.keys(compact).length ? compact : task;
}

/**
 * Remove normal DataForSEO envelope bookkeeping while retaining everything an
 * agent needs to continue an async task or associate every result in a batch.
 */
export function compactDataForSeoResponse(data: unknown): unknown {
  if (!isRecord(data) || !Array.isArray(data.tasks)) return data;

  const tasks = data.tasks;
  if (!isDataForSeoSuccessCode(data.status_code)) {
    // This helper is also safe to call independently of executeApiRequest.
    // Never hide a top-level failure when doing so.
    const errorEnvelope: Record<string, unknown> = {};
    for (const key of ["status_code", "status_message", "cost"]) {
      copyTaskField(data, errorEnvelope, key);
    }
    defineOwn(
      errorEnvelope,
      "tasks",
      tasks.map((task) => compactTask(task, true, true))
    );
    return errorEnvelope;
  }

  if (tasks.length === 1 && isRecord(tasks[0])) {
    const task = tasks[0];
    const successful = isDataForSeoSuccessCode(task.status_code);
    if (
      successful &&
      hasOwn(task, "result") &&
      task.result !== null &&
      task.result !== undefined
    ) {
      return task.result;
    }
    // Task POST responses normally have result:null and status 20100. Keeping
    // their ID is essential for a later task_get request.
    return compactTask(task, !successful, true, data.cost);
  }

  if (tasks.length > 1) {
    return tasks.map((task) => compactTask(task, true, true));
  }

  // An empty task collection is already the smallest lossless representation.
  return [];
}

export const compactDataForSEOResponse = compactDataForSeoResponse;
