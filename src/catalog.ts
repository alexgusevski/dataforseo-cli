import {
  CATALOG_SOURCE,
  GENERATED_BODY_EXAMPLES,
  GENERATED_ENDPOINTS,
  GENERATED_FAMILIES,
  GENERATED_REQUEST_SHAPES,
  GeneratedHttpMethod,
  GeneratedRequirement,
} from "./catalog.generated";

export { CATALOG_SOURCE };
export type { CatalogSourceMetadata } from "./catalog.generated";

export type CatalogHttpMethod = GeneratedHttpMethod;
export type FieldRequirement = "required" | "conditional" | "optional";

export interface CatalogPathParameter {
  name: string;
  type: string;
  required: boolean;
  example: unknown;
}

export interface CatalogRequestField {
  name: string;
  type: string;
  requirement: FieldRequirement;
}

export interface CatalogEndpoint {
  /** Stable, unique identifier inside this catalog. */
  id: string;
  method: CatalogHttpMethod;
  /** Canonical OpenAPI path template, always rooted at /v3. */
  path: string;
  /** First path component after /v3, suitable for --family filtering. */
  family: string;
  /** Official OpenAPI tag. */
  tag: string;
  /** Official operationId. It is not guaranteed to be unique. */
  operationId: string;
  /** Cleaned first sentence, capped at 160 characters. */
  description: string;
  pathParameters: readonly CatalogPathParameter[];
  hasBody: boolean;
  bodyIsArray: boolean;
  bodyExample: unknown | null;
  requestFields: readonly CatalogRequestField[];
  /** Whether DataForSEO officially supports the compact .ai response suffix. */
  aiOptimized: boolean;
  /** LLM-friendly official documentation. */
  docsUrl: string;
}

export interface CatalogFamily {
  family: string;
  tag: string;
  count: number;
}

export interface CatalogSearchOptions {
  limit?: number;
  family?: string;
  method?: string;
  aiOptimized?: boolean;
}

export interface CatalogSearchResult {
  endpoint: CatalogEndpoint;
  score: number;
}

export interface EndpointDescription {
  id: string;
  operationId: string;
  method: CatalogHttpMethod;
  path: string;
  family: string;
  tag: string;
  summary: string;
  docs: string;
  aiOptimized: boolean;
  pathParameters: readonly CatalogPathParameter[];
  body: null | {
    array: boolean;
    fields: readonly CatalogRequestField[];
    example: unknown | null;
  };
}

export type EndpointMatchSource = "operationId" | "path" | "template";

export type EndpointResolution =
  | {
      kind: "match";
      endpoint: CatalogEndpoint;
      matchedBy: EndpointMatchSource;
      concretePath: string;
      pathValues: Readonly<Record<string, string>>;
    }
  | {
      kind: "ambiguous";
      reference: string;
      candidates: readonly CatalogEndpoint[];
    }
  | {
      kind: "not_found";
      reference: string;
      candidates: readonly [];
    };

const REQUIREMENTS: Readonly<Record<GeneratedRequirement, FieldRequirement>> = {
  r: "required",
  c: "conditional",
  o: "optional",
};

const familiesByIndex = GENERATED_FAMILIES.map(([family, tag]) => ({ family, tag }));

/** Convert a canonical API path into DataForSEO's LLM-friendly documentation URL. */
export function docsUrlForPath(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0];
  const canonical = (withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`)
    .replace(/\/\{[^/{}]+\}/g, "")
    .replace(/\/$/, "");
  return `https://docs.dataforseo.com${canonical}.md`;
}

export const ENDPOINT_CATALOG: readonly CatalogEndpoint[] = Object.freeze(
  GENERATED_ENDPOINTS.map(
    ([
      method,
      path,
      familyIndex,
      operationId,
      description,
      generatedPathParameters,
      requestShapeIndex,
      bodyExampleIndex,
      bodyIsArray,
      aiOptimized,
    ]) => {
      const family = familiesByIndex[familyIndex];
      if (!family) throw new Error(`Invalid generated family index ${familyIndex}`);

      const hasBody = requestShapeIndex >= 0;
      const pathParameters = generatedPathParameters.map(([name, type, required, example]) =>
        Object.freeze({ name, type, required, example }),
      );
      const requestFields = hasBody
        ? (GENERATED_REQUEST_SHAPES[requestShapeIndex] ?? []).map(
            ([name, type, requirement]) =>
              Object.freeze({ name, type, requirement: REQUIREMENTS[requirement] }),
          )
        : [];

      return Object.freeze({
        id: `${method} ${path}`,
        method,
        path,
        family: family.family,
        tag: family.tag,
        operationId,
        description,
        pathParameters: Object.freeze(pathParameters),
        hasBody,
        bodyIsArray,
        bodyExample: hasBody ? (GENERATED_BODY_EXAMPLES[bodyExampleIndex] ?? null) : null,
        requestFields: Object.freeze(requestFields),
        aiOptimized,
        docsUrl: docsUrlForPath(path),
      });
    },
  ),
);

/** Short alias for programmatic consumers. */
export const CATALOG = ENDPOINT_CATALOG;

const mutableFamilyCounts: Record<string, number> = Object.create(null);
for (const endpoint of ENDPOINT_CATALOG) {
  mutableFamilyCounts[endpoint.family] = (mutableFamilyCounts[endpoint.family] ?? 0) + 1;
}

export const FAMILY_COUNTS: Readonly<Record<string, number>> = Object.freeze(
  mutableFamilyCounts,
);
export const familyCounts = FAMILY_COUNTS;

export const CATALOG_FAMILIES: readonly CatalogFamily[] = Object.freeze(
  familiesByIndex.map(({ family, tag }) =>
    Object.freeze({ family, tag, count: FAMILY_COUNTS[family] ?? 0 }),
  ),
);

function normalizeSearchText(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z\d]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensFor(value: string): string[] {
  return [...new Set(normalizeSearchText(value).split(" ").filter(Boolean))];
}

interface SearchIndexEntry {
  endpoint: CatalogEndpoint;
  all: string;
  operation: string;
  path: string;
  pathTokens: ReadonlySet<string>;
  operationTokens: ReadonlySet<string>;
  familyTokens: ReadonlySet<string>;
  fieldTokens: ReadonlySet<string>;
  description: string;
}

const SEARCH_INDEX: readonly SearchIndexEntry[] = ENDPOINT_CATALOG.map((endpoint) => {
  const operation = normalizeSearchText(endpoint.operationId);
  const path = normalizeSearchText(endpoint.path);
  const family = normalizeSearchText(`${endpoint.family} ${endpoint.tag}`);
  const fields = normalizeSearchText(endpoint.requestFields.map(({ name }) => name).join(" "));
  const description = normalizeSearchText(endpoint.description);
  return {
    endpoint,
    all: `${operation} ${path} ${family} ${fields} ${description}`,
    operation,
    path,
    pathTokens: new Set(path.split(" ")),
    operationTokens: new Set(operation.split(" ")),
    familyTokens: new Set(family.split(" ")),
    fieldTokens: new Set(fields.split(" ")),
    description,
  };
});

function normalizeMethod(method: string | undefined): CatalogHttpMethod | undefined {
  if (!method) return undefined;
  const normalized = method.toUpperCase();
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"].includes(
    normalized,
  )
    ? (normalized as CatalogHttpMethod)
    : undefined;
}

function familyMatches(endpoint: CatalogEndpoint, requested: string | undefined): boolean {
  if (!requested) return true;
  const normalized = normalizeSearchText(requested);
  return (
    normalizeSearchText(endpoint.family) === normalized || normalizeSearchText(endpoint.tag) === normalized
  );
}

function searchScore(index: SearchIndexEntry, normalizedQuery: string, tokens: readonly string[]) {
  if (!tokens.every((token) => index.all.includes(token))) return -1;

  let score = 0;
  if (normalizedQuery === index.operation) score += 10_000;
  if (normalizedQuery === index.path) score += 9_000;
  if (index.operation.startsWith(normalizedQuery)) score += 600;
  if (index.path.includes(normalizedQuery)) score += 500;

  for (const token of tokens) {
    if (index.operationTokens.has(token)) score += 90;
    else if (index.operation.includes(token)) score += 55;

    if (index.pathTokens.has(token)) score += 80;
    else if (index.path.includes(token)) score += 45;

    if (index.familyTokens.has(token)) score += 35;
    if (index.fieldTokens.has(token)) score += 20;
    if (index.description.includes(token)) score += 10;
  }

  // Prefer the narrower endpoint when relevance is otherwise identical.
  return score - index.endpoint.path.length / 1_000;
}

/**
 * Search with AND semantics: every normalized query token must match. Results
 * include scores for diagnostics while remaining small enough for CLI output.
 */
export function searchCatalog(
  query: string,
  options: CatalogSearchOptions = {},
): CatalogSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = tokensFor(query);
  const requestedMethod = normalizeMethod(options.method);
  const requestedLimit = Number.isFinite(options.limit) ? Math.trunc(options.limit!) : 20;
  const limit = Math.max(0, Math.min(ENDPOINT_CATALOG.length, requestedLimit));

  if (options.method && !requestedMethod) return [];

  return SEARCH_INDEX.filter(
    ({ endpoint }) =>
      (!requestedMethod || endpoint.method === requestedMethod) &&
      familyMatches(endpoint, options.family) &&
      (options.aiOptimized === undefined || endpoint.aiOptimized === options.aiOptimized),
  )
    .map((index) => ({ endpoint: index.endpoint, score: searchScore(index, normalizedQuery, tokens) }))
    .filter(({ score }) => score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.endpoint.path.localeCompare(right.endpoint.path) ||
        left.endpoint.method.localeCompare(right.endpoint.method),
    )
    .slice(0, limit);
}

/** Search helper for callers that do not need relevance scores. */
export function searchEndpoints(
  query: string,
  options: CatalogSearchOptions = {},
): CatalogEndpoint[] {
  return searchCatalog(query, options).map(({ endpoint }) => endpoint);
}

const endpointsByOperationId = new Map<string, CatalogEndpoint[]>();
const endpointsByPath = new Map<string, CatalogEndpoint[]>();
for (const endpoint of ENDPOINT_CATALOG) {
  const operationKey = endpoint.operationId.toLowerCase();
  endpointsByOperationId.set(operationKey, [
    ...(endpointsByOperationId.get(operationKey) ?? []),
    endpoint,
  ]);

  const pathKey = endpoint.path.toLowerCase();
  endpointsByPath.set(pathKey, [...(endpointsByPath.get(pathKey) ?? []), endpoint]);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface TemplateMatcher {
  endpoint: CatalogEndpoint;
  names: readonly string[];
  expression: RegExp;
}

const TEMPLATE_MATCHERS: readonly TemplateMatcher[] = ENDPOINT_CATALOG.filter(({ path }) =>
  path.includes("{"),
).map((endpoint) => {
  const names: string[] = [];
  let expression = "^";
  let cursor = 0;

  for (const match of endpoint.path.matchAll(/\{([^}]+)\}/g)) {
    expression += escapeRegularExpression(endpoint.path.slice(cursor, match.index));
    expression += "([^/]+)";
    names.push(match[1]);
    cursor = (match.index ?? 0) + match[0].length;
  }
  expression += `${escapeRegularExpression(endpoint.path.slice(cursor))}$`;
  return { endpoint, names, expression: new RegExp(expression, "i") };
});

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

interface ParsedReference {
  value: string;
  method?: CatalogHttpMethod;
  path?: string;
  aiRequested: boolean;
  conflictingMethod: boolean;
}

function parseReference(reference: string, method: string | undefined): ParsedReference {
  let value = reference.trim();
  const methodPrefix = value.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+(.+)$/i);
  const prefixedMethod = normalizeMethod(methodPrefix?.[1]);
  if (methodPrefix) value = methodPrefix[2].trim();

  const requestedMethod = normalizeMethod(method);
  const conflictingMethod = Boolean(
    method && (!requestedMethod || (prefixedMethod && requestedMethod !== prefixedMethod)),
  );
  const resolvedMethod = requestedMethod ?? prefixedMethod;

  let path: string | undefined;
  if (/^https?:\/\//i.test(value)) {
    try {
      path = new URL(value).pathname;
    } catch {
      path = undefined;
    }
  } else if (value.startsWith("/") || value.includes("/")) {
    path = value.split(/[?#]/, 1)[0];
  }

  let aiRequested = false;
  if (path) {
    path = path.startsWith("/") ? path : `/${path}`;
    if (!/^\/v3(?:\/|$)/i.test(path)) path = `/v3${path}`;
    if (path.length > 1) path = path.replace(/\/$/, "");
    if (/\.ai$/i.test(path)) {
      path = path.slice(0, -3);
      aiRequested = true;
    }
  }

  return { value, method: resolvedMethod, path, aiRequested, conflictingMethod };
}

function filterCandidates(
  candidates: readonly CatalogEndpoint[],
  method: CatalogHttpMethod | undefined,
  aiRequested: boolean,
): CatalogEndpoint[] {
  return candidates.filter(
    (endpoint) =>
      (!method || endpoint.method === method) && (!aiRequested || endpoint.aiOptimized),
  );
}

function resolved(
  reference: string,
  candidates: readonly CatalogEndpoint[],
  matchedBy: EndpointMatchSource,
  concretePath?: string,
  pathValues: Readonly<Record<string, string>> = {},
): EndpointResolution {
  if (candidates.length === 1) {
    return {
      kind: "match",
      endpoint: candidates[0],
      matchedBy,
      concretePath: concretePath ?? candidates[0].path,
      pathValues,
    };
  }
  if (candidates.length > 1) return { kind: "ambiguous", reference, candidates };
  return { kind: "not_found", reference, candidates: [] };
}

/**
 * Resolve an operationId, a canonical template, or a concrete API path. A
 * duplicate operationId is deliberately returned as an ambiguous result.
 */
export function resolveEndpoint(reference: string, method?: string): EndpointResolution {
  const parsed = parseReference(reference, method);
  if (!reference.trim() || parsed.conflictingMethod) {
    return { kind: "not_found", reference, candidates: [] };
  }

  if (!parsed.path) {
    const candidates = filterCandidates(
      endpointsByOperationId.get(parsed.value.toLowerCase()) ?? [],
      parsed.method,
      parsed.aiRequested,
    );
    return resolved(reference, candidates, "operationId");
  }

  const exactCandidates = filterCandidates(
    endpointsByPath.get(parsed.path.toLowerCase()) ?? [],
    parsed.method,
    parsed.aiRequested,
  );
  if (exactCandidates.length) return resolved(reference, exactCandidates, "path");

  const templateMatches = TEMPLATE_MATCHERS.flatMap(({ endpoint, names, expression }) => {
    if (parsed.method && endpoint.method !== parsed.method) return [];
    if (parsed.aiRequested && !endpoint.aiOptimized) return [];
    const match = expression.exec(parsed.path!);
    if (!match) return [];
    const pathValues = Object.fromEntries(
      names.map((name, index) => [name, safeDecode(match[index + 1])]),
    );
    let captureIndex = 1;
    const concretePath = endpoint.path.replace(
      /\{[^}]+\}/g,
      () => match[captureIndex++],
    );
    return [{ endpoint, pathValues, concretePath }];
  });

  if (templateMatches.length === 1) {
    return resolved(
      reference,
      [templateMatches[0].endpoint],
      "template",
      templateMatches[0].concretePath,
      templateMatches[0].pathValues,
    );
  }
  if (templateMatches.length > 1) {
    return resolved(
      reference,
      templateMatches.map(({ endpoint }) => endpoint),
      "template",
      parsed.path,
    );
  }
  return { kind: "not_found", reference, candidates: [] };
}

/** Shape used directly by the CLI's describe command and JSON output. */
export function describeEndpoint(endpoint: CatalogEndpoint): EndpointDescription {
  return {
    id: endpoint.id,
    operationId: endpoint.operationId,
    method: endpoint.method,
    path: endpoint.path,
    family: endpoint.family,
    tag: endpoint.tag,
    summary: endpoint.description,
    docs: endpoint.docsUrl,
    aiOptimized: endpoint.aiOptimized,
    pathParameters: endpoint.pathParameters,
    body: endpoint.hasBody
      ? {
          array: endpoint.bodyIsArray,
          fields: endpoint.requestFields,
          example: endpoint.bodyExample,
        }
      : null,
  };
}

if (CATALOG_SOURCE.operationCount !== ENDPOINT_CATALOG.length) {
  throw new Error(
    `Generated catalog metadata says ${CATALOG_SOURCE.operationCount} operations, ` +
      `but ${ENDPOINT_CATALOG.length} were loaded`,
  );
}
