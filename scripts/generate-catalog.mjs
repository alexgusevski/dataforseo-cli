#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

// Updating the catalog is an explicit, reviewable operation: bump this commit,
// run the generator, and commit both this file and catalog.generated.ts.
const SOURCE_COMMIT = "77ad3da06857d17770535696606bcf435eea965b";
const SOURCE_REPOSITORY = "https://github.com/dataforseo/OpenApiDocumentation";
const SOURCE_URL = `https://raw.githubusercontent.com/dataforseo/OpenApiDocumentation/${SOURCE_COMMIT}/openapi_specification.yaml`;
const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
]);

// The pinned OpenAPI document has a few known request-schema omissions. Keep
// corrections small and reviewable, and fail generation if an override no
// longer corresponds to a discovered field.
const REQUIRED_FIELD_OVERRIDES = new Map([
  ["LlmMentionsMultiTargetMetricsLive", new Set(["targets"])],
  ["WebhookResend", new Set(["id"])],
]);
const EXAMPLE_FIELD_OVERRIDES = new Map([
  ["InstantPages", new Set(["enable_javascript"])],
]);
// Upstream examples occasionally lag their schema. Drop only these reviewed
// stale keys, and fail on any new mismatch so catalog updates cannot hide it.
const IGNORED_EXAMPLE_FIELDS = new Map([
  ["BulkNewLostReferringDomainsLive", new Set(["datetime_from"])],
  ["GoogleHistoricalSerpsLive", new Set(["datetime_from", "datetime_to", "limit"])],
  ["GoogleHotelSearchesLive", new Set(["priority"])],
]);
// Six YouTube component schemas in the pinned file are empty. These compact
// shapes are transcribed from the corresponding official endpoint pages.
const REQUEST_FIELD_OVERRIDES = new Map([
  ["YoutubeOrganicLiveAdvanced", [
    ["keyword", "string", "r"],
    ["location_code", "integer", "c"],
    ["language_code", "string", "c"],
    ["device", "string", "o"],
    ["block_depth", "integer", "o"],
    ["location_name", "string", "c"],
    ["language_name", "string", "c"],
    ["os", "string", "o"],
    ["tag", "string", "o"],
    ["search_param", "string", "o"],
  ]],
  ["YoutubeOrganicTaskPost", [
    ["keyword", "string", "r"],
    ["location_code", "integer", "c"],
    ["language_code", "string", "c"],
    ["device", "string", "o"],
    ["priority", "integer", "o"],
    ["pingback_url", "string", "o"],
    ["postback_url", "string", "o"],
    ["postback_data", "string", "c"],
    ["location_name", "string", "c"],
    ["language_name", "string", "c"],
    ["os", "string", "o"],
    ["tag", "string", "o"],
    ["search_param", "string", "o"],
    ["block_depth", "integer", "o"],
  ]],
  ["YoutubeVideoCommentsTaskPost", [
    ["video_id", "string", "r"],
    ["location_code", "integer", "c"],
    ["language_code", "string", "c"],
    ["depth", "integer", "o"],
    ["priority", "integer", "o"],
    ["device", "string", "o"],
    ["pingback_url", "string", "o"],
    ["postback_url", "string", "o"],
    ["postback_data", "string", "c"],
    ["location_name", "string", "c"],
    ["language_name", "string", "c"],
    ["os", "string", "o"],
    ["tag", "string", "o"],
  ]],
  ["YoutubeVideoInfoTaskPost", [
    ["video_id", "string", "r"],
    ["location_code", "integer", "c"],
    ["language_code", "string", "c"],
    ["priority", "integer", "o"],
    ["device", "string", "o"],
    ["pingback_url", "string", "o"],
    ["postback_url", "string", "o"],
    ["postback_data", "string", "c"],
    ["location_name", "string", "c"],
    ["language_name", "string", "c"],
    ["os", "string", "o"],
    ["tag", "string", "o"],
  ]],
  ["YoutubeVideoSubtitlesLiveAdvanced", [
    ["video_id", "string", "r"],
    ["location_code", "integer", "c"],
    ["language_code", "string", "c"],
    ["device", "string", "o"],
    ["location_name", "string", "c"],
    ["language_name", "string", "c"],
    ["os", "string", "o"],
    ["tag", "string", "o"],
    ["subtitles_language", "string", "o"],
    ["subtitles_translate_language", "string", "o"],
  ]],
  ["YoutubeVideoSubtitlesTaskPost", [
    ["video_id", "string", "r"],
    ["location_code", "integer", "c"],
    ["language_code", "string", "c"],
    ["priority", "integer", "o"],
    ["device", "string", "o"],
    ["pingback_url", "string", "o"],
    ["postback_url", "string", "o"],
    ["postback_data", "string", "c"],
    ["location_name", "string", "c"],
    ["language_name", "string", "c"],
    ["os", "string", "o"],
    ["tag", "string", "o"],
    ["subtitles_language", "string", "o"],
    ["subtitles_translate_language", "string", "o"],
  ]],
]);
const LIVE_PATH_EXCEPTIONS = new Set([
  "/v3/on_page/instant_pages",
  "/v3/serp/ai_summary",
  "/v3/serp/screenshot",
]);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");

function usage() {
  return [
    "Usage: node scripts/generate-catalog.mjs [openapi.yaml] [output.ts] [--check]",
    "",
    `With no input file, fetches the pinned official schema at ${SOURCE_COMMIT}.`,
    "--check compares generated output with the existing output file.",
  ].join("\n");
}

function parseArguments(argv) {
  const positional = [];
  let check = false;

  for (const argument of argv) {
    if (argument === "--check") {
      check = true;
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}\n${usage()}`);
    } else {
      positional.push(argument);
    }
  }

  if (positional.length > 2) throw new Error(usage());

  return {
    input: positional[0],
    output: resolve(positional[1] ?? resolve(projectDirectory, "src/catalog.generated.ts")),
    check,
  };
}

async function readSchema(input) {
  if (!input) {
    const response = await fetch(SOURCE_URL);
    if (!response.ok) {
      throw new Error(`Could not fetch official OpenAPI schema: HTTP ${response.status}`);
    }
    return response.text();
  }

  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input);
    if (!response.ok) throw new Error(`Could not fetch ${input}: HTTP ${response.status}`);
    return response.text();
  }

  return readFile(resolve(input), "utf8");
}

function decodeEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    nbsp: " ",
    quot: '"',
    rdquo: "”",
    rsquo: "’",
  };

  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function cleanText(value) {
  return decodeEntities(String(value ?? "").replace(/<[^>]*>/g, " "))
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortDescription(value) {
  let description = cleanText(value);
  const firstSentence = description.match(/^(.+?[.!?])(?:\s|$)/)?.[1];
  if (firstSentence && firstSentence.length <= 160) description = firstSentence;

  if (description.length <= 160) return description;

  let shortened = description.slice(0, 159);
  const lastSpace = shortened.lastIndexOf(" ");
  if (lastSpace >= 100) shortened = shortened.slice(0, lastSpace);
  return `${shortened}…`;
}

function operationTitle(operationId) {
  return String(operationId)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function referenceName(reference) {
  return typeof reference === "string" ? reference.split("/").at(-1) : undefined;
}

function dereference(schema, document) {
  const name = referenceName(schema?.$ref);
  if (!name) return schema;
  const target = document.components?.schemas?.[name];
  if (!target) throw new Error(`Unresolved schema reference: ${schema.$ref}`);
  return target;
}

function schemaType(schema, document) {
  if (!schema) return "unknown";
  const resolved = dereference(schema, document);

  if (resolved.type === "array") return `${schemaType(resolved.items, document)}[]`;
  if (resolved.type) return resolved.type;

  const alternatives = [...(resolved.oneOf ?? []), ...(resolved.anyOf ?? [])]
    .map((candidate) => schemaType(candidate, document))
    .filter((value, index, values) => value !== "unknown" && values.indexOf(value) === index);
  return alternatives.length ? alternatives.join("|") : "object";
}

function requirementFor(property, explicitlyRequired) {
  if (explicitlyRequired) return "r";
  const description = cleanText(property?.description).toLowerCase();
  if (/required (?:field )?(?:if|when)\b/.test(description)) return "c";
  if (/\brequired field\b/.test(description)) return "r";
  return "o";
}

function resolveParameter(parameter, document) {
  const name = referenceName(parameter?.$ref);
  if (!name) return parameter;
  const target = document.components?.parameters?.[name];
  if (!target) throw new Error(`Unresolved parameter reference: ${parameter.$ref}`);
  return target;
}

function requestSchemaFor(operation, document) {
  const content = operation.requestBody?.content?.["application/json"];
  const bodySchema = content?.schema;
  if (!bodySchema) return { bodySchema: undefined, requestSchema: undefined, example: null };

  const itemSchema = bodySchema.type === "array" ? bodySchema.items : bodySchema;
  const reference =
    itemSchema?.$ref ?? itemSchema?.oneOf?.find((candidate) => candidate?.$ref)?.$ref;
  const requestSchema = reference
    ? document.components?.schemas?.[referenceName(reference)]
    : dereference(itemSchema, document);

  if (reference && !requestSchema) throw new Error(`Unresolved request schema: ${reference}`);

  return {
    bodySchema,
    requestSchema,
    example: bodySchema.example ?? content.example ?? requestSchema?.example ?? null,
  };
}

function requestFieldsFor(requestSchema, document) {
  if (!requestSchema) return [];
  const resolved = dereference(requestSchema, document);
  const required = new Set(resolved.required ?? []);
  return Object.entries(resolved.properties ?? {}).map(([name, property]) => [
    name,
    schemaType(property, document),
    requirementFor(property, required.has(name)),
  ]);
}

function exampleObject(example) {
  const candidate = Array.isArray(example) ? example[0] : example;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate
    : undefined;
}

function inferredExampleType(value) {
  if (Array.isArray(value)) {
    const sample = value.find((item) => item !== null && item !== undefined);
    return `${sample === undefined ? "unknown" : inferredExampleType(sample)}[]`;
  }
  if (value === null) return "unknown";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "object") return "object";
  return typeof value;
}

function markOverride(counts, operationId) {
  counts.set(operationId, (counts.get(operationId) ?? 0) + 1);
}

function completeRequestFields(operationId, schemaFields, example, overrideCounts) {
  const requestOverride = REQUEST_FIELD_OVERRIDES.get(operationId);
  if (requestOverride) {
    markOverride(overrideCounts.request, operationId);
    if (schemaFields.length > 0) {
      throw new Error(
        `${operationId} now has OpenAPI request fields; review and remove its manual override`,
      );
    }
  }
  const fields = (requestOverride ?? schemaFields).map((field) => [...field]);
  const known = new Set(fields.map(([name]) => name));
  const sample = exampleObject(example) ?? {};
  const exampleOverrides = EXAMPLE_FIELD_OVERRIDES.get(operationId);
  if (exampleOverrides) markOverride(overrideCounts.example, operationId);
  for (const name of exampleOverrides ?? []) {
    if (!Object.prototype.hasOwnProperty.call(sample, name)) {
      throw new Error(`${operationId} example-field override is missing ${name}`);
    }
    if (!known.has(name)) {
      fields.push([name, inferredExampleType(sample[name]), "o"]);
      known.add(name);
    }
  }

  const requiredOverrides = REQUIRED_FIELD_OVERRIDES.get(operationId);
  if (requiredOverrides) {
    markOverride(overrideCounts.required, operationId);
    for (const name of requiredOverrides) {
      const field = fields.find(([fieldName]) => fieldName === name);
      if (!field) throw new Error(`${operationId} required-field override is missing ${name}`);
      field[2] = "r";
    }
  }
  return fields;
}

function sanitizeRequestExample(operationId, example, requestFields, overrideCounts) {
  if (example === null || example === undefined) return example;
  const allowed = new Set(requestFields.map(([name]) => name));
  const ignored = IGNORED_EXAMPLE_FIELDS.get(operationId);
  const ignoredSeen = new Set();
  if (ignored) markOverride(overrideCounts.ignoredExample, operationId);

  function sanitize(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const filtered = {};
    for (const [name, fieldValue] of Object.entries(value)) {
      if (allowed.has(name)) {
        filtered[name] = fieldValue;
      } else if (ignored?.has(name)) {
        ignoredSeen.add(name);
      } else {
        throw new Error(
          `${operationId} example field ${name} is absent from its request shape; review it`,
        );
      }
    }
    return filtered;
  }

  const sanitized = Array.isArray(example) ? example.map(sanitize) : sanitize(example);
  for (const name of ignored ?? []) {
    if (!ignoredSeen.has(name)) {
      throw new Error(`${operationId} ignored-example override is missing ${name}`);
    }
  }
  return sanitized;
}

function pathParametersFor(pathItem, operation, document) {
  const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
    .map((parameter) => resolveParameter(parameter, document))
    .filter((parameter) => parameter?.in === "path")
    .map((parameter) => [
      parameter.name,
      schemaType(parameter.schema, document),
      Boolean(parameter.required),
      parameter.example ?? parameter.schema?.example ?? null,
    ]);

  const namesInTemplate = [...operation.__path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  for (const name of namesInTemplate) {
    if (!parameters.some((parameter) => parameter[0] === name)) {
      throw new Error(`${operation.__method.toUpperCase()} ${operation.__path} is missing path parameter ${name}`);
    }
  }
  return parameters;
}

function isAiOptimized(method, path) {
  const segments = path.toLowerCase().split("/").filter(Boolean);
  const locationsIndex = segments.lastIndexOf("locations");
  const locationEndpoint =
    locationsIndex !== -1 &&
    (locationsIndex === segments.length - 1 ||
      (locationsIndex === segments.length - 2 && /^\{[^}]+\}$/.test(segments.at(-1))));
  return (
    segments.includes("live") ||
    (method === "post" && LIVE_PATH_EXCEPTIONS.has(path)) ||
    (method === "get" && segments.includes("task_get")) ||
    (method === "get" && locationEndpoint)
  );
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function poolValues(values) {
  const pool = [];
  const indexes = new Map();
  const valueIndexes = [];

  for (const value of values) {
    const serialized = JSON.stringify(value);
    let index = indexes.get(serialized);
    if (index === undefined) {
      index = pool.length;
      indexes.set(serialized, index);
      pool.push(value);
    }
    valueIndexes.push(index);
  }

  return { pool, valueIndexes };
}

function buildCatalog(document) {
  if (!document?.paths || typeof document.paths !== "object") {
    throw new Error("OpenAPI document does not contain a paths object");
  }

  const expanded = [];
  const seen = new Set();
  const overrideCounts = {
    request: new Map(),
    example: new Map(),
    required: new Map(),
    ignoredExample: new Map(),
  };

  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, operationValue] of Object.entries(pathItem ?? {})) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;

      const operation = { ...operationValue, __method: method, __path: path };
      const key = `${method.toUpperCase()} ${path}`;
      if (seen.has(key)) throw new Error(`Duplicate operation: ${key}`);
      seen.add(key);

      if (!operation.operationId) throw new Error(`${key} is missing operationId`);
      if (!operation.tags?.length) throw new Error(`${key} is missing an OpenAPI tag`);

      const family = path.match(/^\/v3\/([^/]+)/)?.[1];
      if (!family) throw new Error(`${key} is outside /v3`);

      const { bodySchema, requestSchema, example } = requestSchemaFor(operation, document);
      const requestFields = completeRequestFields(
        String(operation.operationId),
        requestFieldsFor(requestSchema, document),
        example,
        overrideCounts,
      );
      expanded.push({
        method: method.toUpperCase(),
        path,
        family,
        tag: String(operation.tags[0]),
        operationId: String(operation.operationId),
        description:
          shortDescription(operation.description) || `${operationTitle(operation.operationId)} endpoint.`,
        pathParameters: pathParametersFor(pathItem, operation, document),
        hasBody: Boolean(bodySchema),
        bodyExample: sanitizeRequestExample(
          String(operation.operationId),
          example,
          requestFields,
          overrideCounts,
        ),
        bodyIsArray: bodySchema?.type === "array",
        aiOptimized: isAiOptimized(method.toLowerCase(), path),
        requestFields,
      });
    }
  }

  for (const [label, overrides, counts] of [
    ["request-field", REQUEST_FIELD_OVERRIDES, overrideCounts.request],
    ["example-field", EXAMPLE_FIELD_OVERRIDES, overrideCounts.example],
    ["required-field", REQUIRED_FIELD_OVERRIDES, overrideCounts.required],
    ["ignored-example", IGNORED_EXAMPLE_FIELDS, overrideCounts.ignoredExample],
  ]) {
    for (const operationId of overrides.keys()) {
      const count = counts.get(operationId) ?? 0;
      if (count !== 1) {
        throw new Error(`${label} override ${operationId} matched ${count} operations; expected 1`);
      }
    }
  }

  expanded.sort(
    (left, right) => compareStrings(left.path, right.path) || compareStrings(left.method, right.method),
  );

  const tagsByFamily = new Map();
  for (const { family, tag } of expanded) {
    const existingTag = tagsByFamily.get(family);
    if (existingTag && existingTag !== tag) {
      throw new Error(`OpenAPI family ${family} uses multiple tags: ${existingTag}, ${tag}`);
    }
    tagsByFamily.set(family, tag);
  }
  const familyPairs = [...new Map(expanded.map(({ family, tag }) => [family, tag])).entries()].sort(
    ([left], [right]) => compareStrings(left, right),
  );
  const familyIndexes = new Map(familyPairs.map(([family], index) => [family, index]));
  const endpointsWithBodies = expanded.filter(({ hasBody }) => hasBody);
  const fieldPool = poolValues(endpointsWithBodies.map(({ requestFields }) => requestFields));
  const examplePool = poolValues(endpointsWithBodies.map(({ bodyExample }) => bodyExample));
  let bodyIndex = 0;

  const entries = expanded.map((endpoint) => {
    const requestShapeIndex = endpoint.hasBody ? fieldPool.valueIndexes[bodyIndex] : -1;
    const bodyExampleIndex = endpoint.hasBody ? examplePool.valueIndexes[bodyIndex++] : -1;
    return [
      endpoint.method,
      endpoint.path,
      familyIndexes.get(endpoint.family),
      endpoint.operationId,
      endpoint.description,
      endpoint.pathParameters,
      requestShapeIndex,
      bodyExampleIndex,
      endpoint.bodyIsArray,
      endpoint.aiOptimized,
    ];
  });

  return {
    families: familyPairs,
    requestShapes: fieldPool.pool,
    examples: examplePool.pool,
    entries,
  };
}

function linesForArray(name, type, values) {
  const lines = values.map((value) => `  ${JSON.stringify(value)},`).join("\n");
  return `export const ${name}: readonly ${type}[] = [\n${lines}\n];`;
}

function renderCatalog(document, schemaText, catalog) {
  const source = {
    repository: SOURCE_REPOSITORY,
    commit: SOURCE_COMMIT,
    specificationUrl: SOURCE_URL,
    specificationSha256: createHash("sha256").update(schemaText).digest("hex"),
    openapi: String(document.openapi ?? ""),
    apiVersion: String(document.info?.version ?? ""),
    operationCount: catalog.entries.length,
  };

  return `// Generated by scripts/generate-catalog.mjs. Do not edit by hand.
// Source: ${SOURCE_REPOSITORY}/blob/${SOURCE_COMMIT}/openapi_specification.yaml

export type GeneratedHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "TRACE";
export type GeneratedRequirement = "r" | "c" | "o";
export type GeneratedFamily = readonly [slug: string, tag: string];
export type GeneratedPathParameter = readonly [name: string, type: string, required: boolean, example: unknown];
export type GeneratedRequestField = readonly [name: string, type: string, requirement: GeneratedRequirement];
export type GeneratedRequestShape = readonly GeneratedRequestField[];
export type GeneratedEndpoint = readonly [
  method: GeneratedHttpMethod,
  path: string,
  familyIndex: number,
  operationId: string,
  description: string,
  pathParameters: readonly GeneratedPathParameter[],
  requestShapeIndex: number,
  bodyExampleIndex: number,
  bodyIsArray: boolean,
  aiOptimized: boolean,
];

export interface CatalogSourceMetadata {
  repository: string;
  commit: string;
  specificationUrl: string;
  specificationSha256: string;
  openapi: string;
  apiVersion: string;
  operationCount: number;
}

export const CATALOG_SOURCE: CatalogSourceMetadata = ${JSON.stringify(source, null, 2)};

${linesForArray("GENERATED_FAMILIES", "GeneratedFamily", catalog.families)}

${linesForArray("GENERATED_REQUEST_SHAPES", "GeneratedRequestShape", catalog.requestShapes)}

${linesForArray("GENERATED_BODY_EXAMPLES", "unknown", catalog.examples)}

${linesForArray("GENERATED_ENDPOINTS", "GeneratedEndpoint", catalog.entries)}
`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const schemaText = await readSchema(options.input);
  const document = parse(schemaText);
  const catalog = buildCatalog(document);
  const rendered = renderCatalog(document, schemaText, catalog);

  if (options.check) {
    let existing;
    try {
      existing = await readFile(options.output, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`${options.output} does not exist`);
      throw error;
    }
    if (existing !== rendered) {
      throw new Error(`${options.output} is out of date; run scripts/generate-catalog.mjs`);
    }
    process.stdout.write(`Catalog is current (${catalog.entries.length} operations).\n`);
    return;
  }

  await writeFile(options.output, rendered, "utf8");
  process.stdout.write(`Generated ${catalog.entries.length} operations in ${options.output}.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
