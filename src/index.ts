#!/usr/bin/env node
import { Command } from "commander";
import { setCredentials, checkCredentials } from "./config";
import {
  searchVolume,
  relatedKeywords,
  competitorKeywords,
  locations,
  languages,
} from "./api";
import { escapeTsvCell, getFormat, output, formatTsv, formatJson } from "./formatters";
import {
  CATALOG_FAMILIES,
  CATALOG_SOURCE,
  ENDPOINT_CATALOG,
  describeEndpoint,
  resolveEndpoint,
  searchCatalog,
  searchEndpoints,
  type CatalogEndpoint,
} from "./catalog";
import {
  DataForSeoRequestError,
  appendAiSuffix,
  compactDataForSeoResponse,
  executeApiRequest,
  getFailedTasks,
  normalizeApiPath,
  substitutePathParams,
} from "./transport";
import {
  parseFieldAssignments,
  prepareRequestBody,
  readDataArgument,
} from "./call-input";
import {
  parseFieldProjection,
  renderAgentOutput,
  validateDotPath,
  type AgentOutputFormat,
} from "./agent-output";

const VERSION = "2.0.0";
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_TIMEOUT_SECONDS = 180;
const MAX_ERROR_OUTPUT_BYTES = 32 * 1024;
const MAX_DIAGNOSTIC_STRING_BYTES = 2 * 1024;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function writeStdout(value: string): void {
  if (value === "") return;
  process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
}

function writeStderr(value: string): void {
  process.stderr.write(value.endsWith("\n") ? value : `${value}\n`);
}

function parsePositiveInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseTimeout(value: string): number {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error("--timeout must be a positive number of seconds");
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) {
    throw new Error("--timeout must be between 0 and 600 seconds");
  }
  return Math.round(seconds * 1_000);
}

function normalizeMethod(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const method = value.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(method)) throw new Error("--method must be an HTTP method");
  return method;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function mergeUnique(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
  label: string,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (Object.prototype.hasOwnProperty.call(merged, key)) {
      throw new Error(`Duplicate ${label} "${key}"`);
    }
    Object.defineProperty(merged, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return merged;
}

function truncateUtf8(value: string, maxBytes = MAX_DIAGNOSTIC_STRING_BYTES): string {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length <= maxBytes) return value;

  const suffix = "…[truncated]";
  const available = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  const prefix = encoded.subarray(0, available).toString("utf8").replace(/\uFFFD$/u, "");
  return `${prefix}${suffix}`;
}

function compactDiagnosticValue(value: unknown): unknown {
  if (typeof value === "string") return truncateUtf8(value);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) return value;
  if (Array.isArray(value)) return { type: "array", length: value.length };
  return { type: typeof value };
}

function compactErrorData(data: unknown): unknown {
  if (typeof data === "string") {
    return { type: "text", bytes: Buffer.byteLength(data, "utf8") };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { type: Array.isArray(data) ? "array" : typeof data };
  }

  const source = data as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ["status_code", "status_message", "cost", "tasks_error"] as const) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      summary[key] = compactDiagnosticValue(source[key]);
    }
  }
  if (Array.isArray(source.tasks)) {
    summary.tasks = source.tasks.slice(0, 20).map((task) => {
      if (typeof task !== "object" || task === null || Array.isArray(task)) {
        return compactDiagnosticValue(task);
      }
      const candidate = task as Record<string, unknown>;
      const diagnostic: Record<string, unknown> = {};
      for (const key of ["id", "status_code", "status_message", "cost"] as const) {
        if (Object.prototype.hasOwnProperty.call(candidate, key)) {
          diagnostic[key] = compactDiagnosticValue(candidate[key]);
        }
      }
      return diagnostic;
    });
    if (source.tasks.length > 20) summary.tasks_omitted = source.tasks.length - 20;
  }
  return summary;
}

function serializeRequestError(error: DataForSeoRequestError): string {
  const details: Record<string, unknown> = { ...error.toJSON() };
  const serialized = formatJson(details);
  if (Buffer.byteLength(serialized, "utf8") <= MAX_ERROR_OUTPUT_BYTES) return serialized;

  const boundedDetails = Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => key !== "data")
      .map(([key, value]) => [key, compactDiagnosticValue(value)]),
  );
  const compact = formatJson({
    ...boundedDetails,
    data: compactErrorData(details.data),
    data_truncated: true,
  });
  if (Buffer.byteLength(compact, "utf8") <= MAX_ERROR_OUTPUT_BYTES) return compact;

  // Keep the last-resort diagnostic valid JSON and strictly bounded even when
  // every upstream message is made entirely of JSON-escaped control bytes.
  return formatJson({
    error: "DataForSeoRequestError",
    kind: error.kind,
    message: truncateUtf8(error.message, 512),
    httpStatus: error.httpStatus,
    statusCode: error.statusCode,
    data_truncated: true,
    detail: "Response diagnostics exceeded the CLI error output limit.",
  });
}

function fail(error: unknown): never {
  if (error instanceof DataForSeoRequestError) {
    writeStderr(serializeRequestError(error));
  } else {
    const message = error instanceof Error ? error.message : String(error);
    writeStderr(`Error: ${escapeTsvCell(message)}`);
  }
  process.exitCode = 1;
  throw error;
}

function credentialPart(part: string): [string, string] | null {
  const separator = part.indexOf("=");
  if (separator <= 0) return null;
  return [part.slice(0, separator), part.slice(separator + 1)];
}

function handleLegacyGlobalOptions(argv: readonly string[]): boolean {
  const args = argv.slice(2);
  const first = args[0];
  if (
    first !== "--print-cache" &&
    first !== "--set-credentials" &&
    first !== "--set-api-key"
  ) return false;

  try {
    if (first === "--print-cache") {
      if (args.length !== 1) throw new Error("--print-cache does not accept arguments");
      const { printCache } = require("./cache");
      printCache();
      return true;
    }

    const credentials: Record<string, string> = {};
    for (const part of args.slice(1)) {
      const parsed = credentialPart(part);
      if (!parsed || !["login", "password", "base64"].includes(parsed[0])) {
        const separator = part.indexOf("=");
        const field = separator > 0 ? part.slice(0, separator) : "";
        const safeField = /^[a-z][a-z0-9_-]{0,31}$/i.test(field) ? ` "${field}"` : "";
        throw new Error(`Invalid credential field${safeField}; expected login, password, or base64`);
      }
      if (Object.prototype.hasOwnProperty.call(credentials, parsed[0])) {
        throw new Error(`Duplicate credential field: ${parsed[0]}`);
      }
      credentials[parsed[0]] = parsed[1];
    }

    if (credentials.base64) {
      if (credentials.login || credentials.password) {
        throw new Error("Use either base64 or login+password credentials, not both");
      }
      setCredentials(undefined, undefined, credentials.base64);
    } else if (credentials.login && credentials.password) {
      setCredentials(credentials.login, credentials.password);
    } else {
      throw new Error(
        "Use --set-credentials login=XXX password=XXX or --set-credentials base64=TOKEN",
      );
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeStderr(`Error: ${message}`);
    process.exitCode = 1;
    return true;
  }
}

function conciseCandidates(endpoints: readonly CatalogEndpoint[]): string {
  return formatTsv(
    endpoints.slice(0, 8).map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      operation: endpoint.operationId,
    })),
  );
}

function endpointResolutionError(reference: string, method?: string): Error {
  const suggestions = searchEndpoints(reference, { method, limit: 5 });
  const suffix = suggestions.length
    ? `\nClosest endpoints:\n${conciseCandidates(suggestions)}`
    : "\nRun `dataforseo-cli endpoints <terms>` to search the catalog.";
  return new Error(`Endpoint not found: ${reference}${suffix}`);
}

function describeText(endpoint: CatalogEndpoint, allFields: boolean): string {
  const description = describeEndpoint(endpoint);
  const lines = [
    `endpoint\t${description.method}\t${description.path}\t${description.operationId}`,
    `family\t${description.family}`,
    `ai_optimized\t${description.aiOptimized ? "yes (default)" : "no"}`,
  ];
  if (description.summary) lines.push(`summary\t${description.summary}`);

  for (const parameter of description.pathParameters) {
    const example = parameter.example === null || parameter.example === undefined
      ? ""
      : `\texample=${formatJson(parameter.example)}`;
    lines.push(
      `path_param\t${parameter.required ? "required" : "optional"}\t${parameter.name}:${parameter.type}${example}`,
    );
  }

  if (description.body) {
    lines.push(`body\t${description.body.array ? "task[] (object auto-wrapped)" : "object"}`);
    const visibleFields = allFields
      ? description.body.fields
      : description.body.fields.filter(({ requirement }) => requirement !== "optional");
    for (const field of visibleFields) {
      lines.push(`field\t${field.requirement}\t${field.name}:${field.type}`);
    }
    if (!allFields && description.body.fields.some(({ requirement }) => requirement === "optional")) {
      lines.push("optional_fields\tuse --all-fields or --json");
    }
    if (description.body.example !== null) {
      const example = Array.isArray(description.body.example) && description.body.example.length === 1
        ? description.body.example[0]
        : description.body.example;
      lines.push(`example\t${formatJson(example)}`);
    }
  }

  lines.push(`docs\t${description.docs}`);
  return lines.join("\n");
}

function installEpipeHandler(): void {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
}

async function main(): Promise<void> {
  installEpipeHandler();
  if (handleLegacyGlobalOptions(process.argv)) return;

  const program = new Command();
  program
    .name("dataforseo-cli")
    .description("Compact, full-coverage DataForSEO CLI for agents")
    .version(VERSION)
    .allowExcessArguments(false)
    .showSuggestionAfterError(true);

  const outputOpts = (command: Command) =>
    command
      .option("--json", "Output as compact JSON")
      .option("--jsonl", "Output as newline-delimited JSON")
      .option("--table", "Output as a human-readable table")
      .option("--human", "Alias for --table");

  outputOpts(
    program
      .command("volume")
      .description("Get search volume, CPC, and difficulty for keywords")
      .argument("<keywords...>", "Keywords to look up")
      .option("-l, --location <code>", "Location code", "2840")
      .option("--language <code>", "Language code", "en"),
  ).action(async (keywords: string[], opts) => {
    const results = await searchVolume(
      keywords,
      parsePositiveInteger(opts.location, "--location"),
      opts.language,
    );
    const rows = results.map((result) => ({
      keyword: result.keyword,
      volume: result.volume,
      cpc: round2(result.cpc),
      difficulty: result.difficulty ?? "",
      competition: result.competition,
      trend: result.trend.join(","),
    }));
    writeStdout(output(rows, getFormat(opts)));
  });

  outputOpts(
    program
      .command("related")
      .description("Find related keywords from a seed keyword")
      .argument("<seed>", "Seed keyword")
      .option("-l, --location <code>", "Location code", "2840")
      .option("--language <code>", "Language code", "en")
      .option("-n, --limit <n>", "Maximum results", "50"),
  ).action(async (seed: string, opts) => {
    const results = await relatedKeywords(
      seed,
      parsePositiveInteger(opts.location, "--location"),
      opts.language,
      parsePositiveInteger(opts.limit, "--limit"),
    );
    const rows = results.map((result) => ({
      keyword: result.keyword,
      volume: result.volume,
      cpc: round2(result.cpc),
      difficulty: result.difficulty ?? "",
      competition: round2(result.competition),
    }));
    writeStdout(output(rows, getFormat(opts)));
  });

  outputOpts(
    program
      .command("competitor")
      .description("Get keywords a domain ranks for")
      .argument("<domain>", "Target domain")
      .option("-l, --location <code>", "Location code", "2840")
      .option("--language <code>", "Language code", "en")
      .option("-n, --limit <n>", "Maximum results", "50"),
  ).action(async (domain: string, opts) => {
    const results = await competitorKeywords(
      domain,
      parsePositiveInteger(opts.location, "--location"),
      opts.language,
      parsePositiveInteger(opts.limit, "--limit"),
    );
    const rows = results.map((result) => ({
      keyword: result.keyword,
      pos: result.position,
      volume: result.volume,
      cpc: round2(result.cpc),
      difficulty: result.difficulty ?? "",
      url: result.url,
    }));
    writeStdout(output(rows, getFormat(opts)));
  });

  program
    .command("status")
    .description("Check whether API credentials are configured")
    .action(() => {
      const { configured, maskedLogin } = checkCredentials();
      if (!configured) {
        writeStdout("not_configured");
        process.exitCode = 1;
        return;
      }
      writeStdout(`configured\t${escapeTsvCell(maskedLogin)}`);
    });

  program
    .command("locations")
    .description("Search Google Ads location codes")
    .argument("[search]", "Filter locations by name")
    .option("-n, --limit <n>", "Maximum matches", "50")
    .option("--all", "Return every matching location")
    .option("--json", "Output as compact JSON")
    .action(async (search: string | undefined, opts) => {
      const validatedLimit = opts.all
        ? undefined
        : parsePositiveInteger(opts.limit, "--limit");
      const results = await locations(search);
      const requestedLimit = opts.all
        ? results.length
        : validatedLimit!;
      const visible = results.slice(0, requestedLimit);
      writeStdout(opts.json ? formatJson(visible) : formatTsv(visible));
      if (results.length > visible.length) {
        writeStderr(`showing ${visible.length}/${results.length}; use --all or --limit ${results.length}`);
      }
    });

  program
    .command("languages")
    .description("Search Google Ads language codes")
    .argument("[search]", "Filter languages by name")
    .option("--json", "Output as compact JSON")
    .action(async (search: string | undefined, opts) => {
      const results = await languages(search);
      writeStdout(opts.json ? formatJson(results) : formatTsv(results));
    });

  program
    .command("endpoints")
    .description("Search the bundled catalog of every DataForSEO API operation")
    .argument("[terms...]", "AND-matched path, operation, field, or summary terms")
    .option("-n, --limit <n>", "Maximum matches", String(DEFAULT_SEARCH_LIMIT))
    .option("--all", "Return every matching endpoint")
    .option("-X, --method <method>", "Filter by HTTP method")
    .option("--family <family>", "Filter by API family")
    .option("--ai", "Only endpoints supporting the compact .ai response")
    .option("--verbose", "Include the endpoint summary")
    .option("--json", "Output as compact JSON")
    .action((terms: string[], opts) => {
      const query = terms.join(" ").trim();
      const method = normalizeMethod(opts.method);

      if (!query && !method && !opts.family && !opts.ai && !opts.all) {
        const rows = CATALOG_FAMILIES.map(({ family, count }) => ({ family, operations: count }));
        writeStdout(opts.json ? formatJson(rows) : formatTsv(rows));
        return;
      }

      const requestedLimit = opts.all
        ? ENDPOINT_CATALOG.length
        : parsePositiveInteger(opts.limit, "--limit");
      const matches = searchCatalog(query, {
        method,
        family: opts.family,
        aiOptimized: opts.ai ? true : undefined,
        limit: ENDPOINT_CATALOG.length,
      });
      const visible = matches.slice(0, requestedLimit).map(({ endpoint }) => ({
        method: endpoint.method,
        path: endpoint.path,
        operation: endpoint.operationId,
        ai: endpoint.aiOptimized ? "yes" : "",
        ...(opts.verbose ? { summary: endpoint.description } : {}),
      }));

      writeStdout(opts.json ? formatJson(visible) : formatTsv(visible));
      if (matches.length > visible.length) {
        writeStderr(`showing ${visible.length}/${matches.length}; use --all or --limit ${matches.length}`);
      }
    });

  program
    .command("describe")
    .description("Show compact request guidance for one endpoint")
    .argument("<endpoint>", "Operation ID, path template, or concrete path")
    .option("-X, --method <method>", "Disambiguate by HTTP method")
    .option("--all-fields", "Include optional request fields")
    .option("--json", "Output the complete catalog entry as compact JSON")
    .action((reference: string, opts) => {
      const method = normalizeMethod(opts.method);
      const resolution = resolveEndpoint(reference, method);
      if (resolution.kind === "ambiguous") {
        throw new Error(
          `Ambiguous endpoint: ${reference}\n${conciseCandidates(resolution.candidates)}`,
        );
      }
      if (resolution.kind === "not_found") throw endpointResolutionError(reference, method);

      const description = describeEndpoint(resolution.endpoint);
      writeStdout(opts.json ? formatJson(description) : describeText(resolution.endpoint, opts.allFields));
    });

  program
    .command("api")
    .alias("call")
    .description("Call any DataForSEO endpoint by operation ID or API path")
    .argument("<endpoint>", "Operation ID or relative /v3 API path")
    .argument("[fields...]", "Compact key=value or typed key:=JSON request fields")
    .option("-X, --method <method>", "Override the HTTP method or disambiguate an operation ID")
    .option("-d, --data <json|@file|->", "Exact JSON body, file, or explicit stdin")
    .option("-q, --query <key=value>", "Add a query parameter", collectOption, [])
    .option("--no-ai", "Disable automatic DataForSEO .ai response optimization")
    .option("--full", "Use the standard endpoint and preserve its complete response envelope")
    .option("--select <path>", "Select a dot-path before output")
    .option("--fields <projection>", "Project output fields: name or alias=dot.path")
    .option("-f, --format <format>", "json, jsonl, tsv, or table")
    .option("--timeout <seconds>", "Request timeout", String(DEFAULT_TIMEOUT_SECONDS))
    .action(async (reference: string, assignmentArgs: string[], opts) => {
      // Validate all purely local output options before a potentially billable
      // API call. Response-dependent path existence is checked after receipt.
      const allowedFormats = new Set<AgentOutputFormat>(["json", "jsonl", "tsv", "table"]);
      const requestedFormat = opts.format?.toLowerCase();
      if (requestedFormat && !allowedFormats.has(requestedFormat as AgentOutputFormat)) {
        throw new Error("--format must be json, jsonl, tsv, or table");
      }
      if (opts.select !== undefined) validateDotPath(opts.select);
      if (opts.fields !== undefined) parseFieldProjection(opts.fields);
      const format = (requestedFormat as AgentOutputFormat | undefined) ??
        (opts.fields ? "tsv" : "json");

      if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith("//")) {
        throw new Error("API calls require a relative DataForSEO path, not an absolute URL");
      }
      if (/[?#]/.test(reference)) {
        throw new Error("Put query parameters in --query; URL queries and fragments are not accepted");
      }
      const assignments = parseFieldAssignments(assignmentArgs);
      const query = parseFieldAssignments(opts.query);
      const data = await readDataArgument(opts.data);
      const requestedMethod = normalizeMethod(opts.method);
      let resolution = resolveEndpoint(reference, requestedMethod);
      if (resolution.kind === "not_found" && requestedMethod) {
        // A unique catalog entry can still be called with an intentional
        // method override. The first lookup retains -X disambiguation for the
        // one duplicated upstream operation ID.
        const withoutMethod = resolveEndpoint(reference);
        if (withoutMethod.kind !== "not_found") resolution = withoutMethod;
      }

      let endpoint: CatalogEndpoint | undefined;
      let method: string;
      let path: string;
      if (resolution.kind === "ambiguous") {
        throw new Error(
          `Ambiguous endpoint: ${reference}\n${conciseCandidates(resolution.candidates)}`,
        );
      } else if (resolution.kind === "match") {
        endpoint = resolution.endpoint;
        method = requestedMethod ?? endpoint.method;
        path = resolution.concretePath;
      } else {
        if (!reference.includes("/")) throw endpointResolutionError(reference, requestedMethod);
        method = requestedMethod ?? (data !== undefined || Object.keys(assignments).length ? "POST" : "GET");
        path = normalizeApiPath(reference);
        writeStderr("warning: endpoint is not in the bundled catalog; using permissive passthrough");
      }

      const substituted = substitutePathParams(path, assignments);
      const upperMethod = method.toUpperCase();
      let body: unknown;
      let requestQuery: Record<string, unknown> = query;
      if (upperMethod === "GET" || upperMethod === "HEAD") {
        if (data !== undefined) throw new Error(`${upperMethod} endpoints do not accept --data`);
        requestQuery = mergeUnique(substituted.remaining, query, "query parameter");
      } else {
        body = prepareRequestBody(
          data,
          substituted.remaining,
          // --data is exact for future/uncatalogued endpoints. Positional
          // fields remain convenient DataForSEO task sugar and are wrapped.
          endpoint?.bodyIsArray ?? (upperMethod === "POST" && data === undefined),
        );
        if (upperMethod === "POST" && body === undefined) {
          throw new Error(
            `POST endpoint requires a body; run \`dataforseo-cli describe ${endpoint?.operationId ?? reference}\``,
          );
        }
      }

      const explicitAi = /\.ai\/?$/i.test(reference);
      if (explicitAi && opts.full) {
        throw new Error("--full cannot be combined with an explicit .ai endpoint");
      }
      const useAi = explicitAi || Boolean(endpoint?.aiOptimized && opts.ai !== false && !opts.full);
      const requestPath = useAi ? appendAiSuffix(substituted.path.replace(/\.ai$/i, "")) : substituted.path;
      const response = await executeApiRequest({
        method: upperMethod,
        path: requestPath,
        body,
        query: requestQuery,
        timeoutMs: parseTimeout(opts.timeout),
      });
      const taskErrors = getFailedTasks(response);
      const result = opts.full || useAi ? response : compactDataForSeoResponse(response);
      writeStdout(
        renderAgentOutput(result, {
          format,
          select: opts.select,
          fields: opts.fields,
        }),
      );

      if (taskErrors.length) {
        const reportedTasks = taskErrors.slice(0, 5).map((task) => ({
          id: typeof task.id === "string" ? truncateUtf8(task.id, 128) : compactDiagnosticValue(task.id),
          status_code: compactDiagnosticValue(task.status_code),
          status_message: typeof task.status_message === "string"
            ? truncateUtf8(task.status_message, 512)
            : compactDiagnosticValue(task.status_message),
        }));
        writeStderr(
          formatJson({
            warning: "one or more DataForSEO tasks did not complete successfully",
            tasks: reportedTasks,
            ...(taskErrors.length > reportedTasks.length
              ? { tasks_omitted: taskErrors.length - reportedTasks.length }
              : {}),
          }),
        );
        process.exitCode = 2;
      }
    });

  program.addHelpText(
    "after",
    `\nAgent workflow:\n  dataforseo-cli endpoints <terms>\n  dataforseo-cli describe <operation-or-path>\n  dataforseo-cli api <operation-or-path> key=value typed:=123\n\nCatalog: ${CATALOG_SOURCE.operationCount} operations from DataForSEO OpenAPI ${CATALOG_SOURCE.commit.slice(0, 8)}`,
  );

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  // Commander already formats usage errors. Runtime failures remain compact
  // and machine-visible on stderr without a stack trace.
  if (process.exitCode) return;
  try {
    fail(error);
  } catch {
    // fail() deliberately throws so TypeScript can treat it as never.
  }
});
