const assert = require("node:assert/strict");
const { statSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const {
  CATALOG_FAMILIES,
  CATALOG_SOURCE,
  ENDPOINT_CATALOG,
  FAMILY_COUNTS,
  describeEndpoint,
  docsUrlForPath,
  resolveEndpoint,
  searchCatalog,
  searchEndpoints,
} = require("../dist/catalog.js");

test("catalog covers every operation in the pinned official schema", () => {
  assert.equal(ENDPOINT_CATALOG.length, 570);
  assert.equal(CATALOG_SOURCE.operationCount, 570);
  assert.match(CATALOG_SOURCE.commit, /^[0-9a-f]{40}$/);
  assert.match(CATALOG_SOURCE.specificationSha256, /^[0-9a-f]{64}$/);

  const ids = new Set(ENDPOINT_CATALOG.map(({ id }) => id));
  assert.equal(ids.size, ENDPOINT_CATALOG.length, "METHOD + path must be unique");
  assert.equal(ENDPOINT_CATALOG.filter(({ method }) => method === "GET").length, 296);
  assert.equal(ENDPOINT_CATALOG.filter(({ method }) => method === "POST").length, 274);
});

test("family counts are complete and sum to the catalog size", () => {
  assert.deepEqual({ ...FAMILY_COUNTS }, {
    ai_optimization: 54,
    app_data: 42,
    appendix: 4,
    backlinks: 24,
    business_data: 54,
    content_analysis: 11,
    dataforseo_labs: 47,
    domain_analytics: 14,
    keywords_data: 70,
    merchant: 38,
    on_page: 31,
    serp: 181,
  });
  assert.equal(
    CATALOG_FAMILIES.reduce((sum, { count }) => sum + count, 0),
    ENDPOINT_CATALOG.length,
  );
});

test("generated records stay compact and descriptions contain no upstream markup", () => {
  const generatedSize = statSync(join(__dirname, "../src/catalog.generated.ts")).size;
  assert.ok(generatedSize < 250 * 1024, `generated catalog is ${generatedSize} bytes`);

  for (const endpoint of ENDPOINT_CATALOG) {
    assert.ok(endpoint.description.length > 0, endpoint.id);
    assert.ok(endpoint.description.length <= 160, endpoint.id);
    assert.doesNotMatch(endpoint.description, /<[^>]+>/, endpoint.id);
    assert.match(endpoint.docsUrl, /^https:\/\/docs\.dataforseo\.com\/v3\/.+\.md$/);
  }
});

test("POST descriptions retain structural fields and official body examples", () => {
  const result = resolveEndpoint("GoogleAdsSearchVolumeLive");
  assert.equal(result.kind, "match");
  assert.equal(result.endpoint.hasBody, true);
  assert.equal(result.endpoint.bodyIsArray, true);
  assert.ok(Array.isArray(result.endpoint.bodyExample));
  assert.deepEqual(result.endpoint.bodyExample[0].keywords, [
    "buy laptop",
    "cheap laptops for sale",
    "purchase laptop",
  ]);

  const keywords = result.endpoint.requestFields.find(({ name }) => name === "keywords");
  const location = result.endpoint.requestFields.find(({ name }) => name === "location_code");
  assert.deepEqual(keywords, {
    name: "keywords",
    type: "string[]",
    requirement: "required",
  });
  assert.equal(location.requirement, "optional");
});

test("request examples fill upstream schema holes and reviewed overrides stay required", () => {
  assert.equal(
    ENDPOINT_CATALOG.filter(({ hasBody }) => hasBody).every(({ requestFields }) => requestFields.length > 0),
    true,
  );

  const youtubeShapes = {
    YoutubeOrganicLiveAdvanced: [
      ["keyword", "string", "required"],
      ["location_code", "integer", "conditional"],
      ["language_code", "string", "conditional"],
      ["device", "string", "optional"],
      ["block_depth", "integer", "optional"],
      ["location_name", "string", "conditional"],
      ["language_name", "string", "conditional"],
      ["os", "string", "optional"],
      ["tag", "string", "optional"],
      ["search_param", "string", "optional"],
    ],
    YoutubeOrganicTaskPost: [
      ["keyword", "string", "required"],
      ["location_code", "integer", "conditional"],
      ["language_code", "string", "conditional"],
      ["device", "string", "optional"],
      ["priority", "integer", "optional"],
      ["pingback_url", "string", "optional"],
      ["postback_url", "string", "optional"],
      ["postback_data", "string", "conditional"],
      ["location_name", "string", "conditional"],
      ["language_name", "string", "conditional"],
      ["os", "string", "optional"],
      ["tag", "string", "optional"],
      ["search_param", "string", "optional"],
      ["block_depth", "integer", "optional"],
    ],
    YoutubeVideoCommentsTaskPost: [
      ["video_id", "string", "required"],
      ["location_code", "integer", "conditional"],
      ["language_code", "string", "conditional"],
      ["depth", "integer", "optional"],
      ["priority", "integer", "optional"],
      ["device", "string", "optional"],
      ["pingback_url", "string", "optional"],
      ["postback_url", "string", "optional"],
      ["postback_data", "string", "conditional"],
      ["location_name", "string", "conditional"],
      ["language_name", "string", "conditional"],
      ["os", "string", "optional"],
      ["tag", "string", "optional"],
    ],
    YoutubeVideoInfoTaskPost: [
      ["video_id", "string", "required"],
      ["location_code", "integer", "conditional"],
      ["language_code", "string", "conditional"],
      ["priority", "integer", "optional"],
      ["device", "string", "optional"],
      ["pingback_url", "string", "optional"],
      ["postback_url", "string", "optional"],
      ["postback_data", "string", "conditional"],
      ["location_name", "string", "conditional"],
      ["language_name", "string", "conditional"],
      ["os", "string", "optional"],
      ["tag", "string", "optional"],
    ],
    YoutubeVideoSubtitlesLiveAdvanced: [
      ["video_id", "string", "required"],
      ["location_code", "integer", "conditional"],
      ["language_code", "string", "conditional"],
      ["device", "string", "optional"],
      ["location_name", "string", "conditional"],
      ["language_name", "string", "conditional"],
      ["os", "string", "optional"],
      ["tag", "string", "optional"],
      ["subtitles_language", "string", "optional"],
      ["subtitles_translate_language", "string", "optional"],
    ],
    YoutubeVideoSubtitlesTaskPost: [
      ["video_id", "string", "required"],
      ["location_code", "integer", "conditional"],
      ["language_code", "string", "conditional"],
      ["priority", "integer", "optional"],
      ["device", "string", "optional"],
      ["pingback_url", "string", "optional"],
      ["postback_url", "string", "optional"],
      ["postback_data", "string", "conditional"],
      ["location_name", "string", "conditional"],
      ["language_name", "string", "conditional"],
      ["os", "string", "optional"],
      ["tag", "string", "optional"],
      ["subtitles_language", "string", "optional"],
      ["subtitles_translate_language", "string", "optional"],
    ],
  };

  for (const [operationId, expectedShape] of Object.entries(youtubeShapes)) {
    const resolution = resolveEndpoint(operationId);
    assert.equal(resolution.kind, "match");
    const endpoint = resolution.endpoint;
    const example = Array.isArray(endpoint.bodyExample)
      ? endpoint.bodyExample[0]
      : endpoint.bodyExample;
    assert.equal(Boolean(example && typeof example === "object" && !Array.isArray(example)), true);
    const fields = new Set(endpoint.requestFields.map(({ name }) => name));
    for (const name of Object.keys(example)) {
      assert.equal(fields.has(name), true, `${endpoint.operationId} is missing example field ${name}`);
    }
    assert.deepEqual(
      endpoint.requestFields.map(({ name, type, requirement }) => [name, type, requirement]),
      expectedShape,
      operationId,
    );
  }

  const multiTarget = resolveEndpoint("LlmMentionsMultiTargetMetricsLive");
  assert.equal(multiTarget.kind, "match");
  assert.equal(
    multiTarget.endpoint.requestFields.find(({ name }) => name === "targets")?.requirement,
    "required",
  );

  const webhook = resolveEndpoint("WebhookResend");
  assert.equal(webhook.kind, "match");
  assert.equal(
    webhook.endpoint.requestFields.find(({ name }) => name === "id")?.requirement,
    "required",
  );

  const instantPages = resolveEndpoint("InstantPages");
  assert.equal(instantPages.kind, "match");
  assert.equal(instantPages.endpoint.requestFields.some(({ name }) => name === "enable_javascript"), true);

  for (const [operationId, staleFields] of [
    ["GoogleHistoricalSerpsLive", ["datetime_from", "datetime_to", "limit"]],
    ["BulkNewLostReferringDomainsLive", ["datetime_from"]],
    ["GoogleHotelSearchesLive", ["priority"]],
  ]) {
    const resolution = resolveEndpoint(operationId);
    assert.equal(resolution.kind, "match");
    const fields = new Set(resolution.endpoint.requestFields.map(({ name }) => name));
    const example = Array.isArray(resolution.endpoint.bodyExample)
      ? resolution.endpoint.bodyExample[0]
      : resolution.endpoint.bodyExample;
    for (const field of staleFields) {
      assert.equal(fields.has(field), false, `${operationId}.${field} request field`);
      assert.equal(
        Boolean(example && typeof example === "object" && Object.prototype.hasOwnProperty.call(example, field)),
        false,
        `${operationId}.${field} example field`,
      );
    }
  }
});

test("path parameters include type, required state, and example", () => {
  const result = resolveEndpoint("/v3/serp/google/locations/{country}");
  assert.equal(result.kind, "match");
  assert.deepEqual(result.endpoint.pathParameters, [
    { name: "country", type: "string", required: true, example: "us" },
  ]);
  assert.equal(
    result.endpoint.docsUrl,
    "https://docs.dataforseo.com/v3/serp/google/locations.md",
  );
  assert.equal(
    docsUrlForPath("v3/serp/google/organic/task_get/advanced/{id}"),
    "https://docs.dataforseo.com/v3/serp/google/organic/task_get/advanced.md",
  );
});

test(".ai capability follows the official Live, Task GET, and locations rules", () => {
  const livePathExceptions = new Set([
    "/v3/on_page/instant_pages",
    "/v3/serp/ai_summary",
    "/v3/serp/screenshot",
  ]);
  for (const endpoint of ENDPOINT_CATALOG) {
    const segments = endpoint.path.split("/");
    const locationsIndex = segments.lastIndexOf("locations");
    const locationEndpoint =
      locationsIndex !== -1 &&
      (locationsIndex === segments.length - 1 ||
        (locationsIndex === segments.length - 2 && /^\{[^}]+\}$/.test(segments.at(-1))));
    const expected =
      segments.includes("live") ||
      (endpoint.method === "POST" && livePathExceptions.has(endpoint.path)) ||
      (endpoint.method === "GET" && segments.includes("task_get")) ||
      (endpoint.method === "GET" && locationEndpoint);
    assert.equal(endpoint.aiOptimized, expected, endpoint.id);
  }

  assert.equal(resolveEndpoint("GoogleOrganicLiveAdvanced").endpoint.aiOptimized, true);
  assert.equal(resolveEndpoint("GoogleOrganicTaskGetAdvanced").endpoint.aiOptimized, true);
  assert.equal(resolveEndpoint("/v3/serp/google/locations").endpoint.aiOptimized, true);
  for (const path of livePathExceptions) {
    assert.equal(resolveEndpoint(path).endpoint.aiOptimized, true, path);
  }
  assert.equal(resolveEndpoint("GoogleOrganicTasksReady").endpoint.aiOptimized, false);
});

test("search uses AND-token matching, exact ranking, and filters", () => {
  const exact = searchCatalog("GoogleKeywordSuggestionsLive", { limit: 3 });
  assert.equal(exact[0].endpoint.operationId, "GoogleKeywordSuggestionsLive");

  const results = searchEndpoints("google keyword suggestions", { limit: 10 });
  assert.equal(results[0].path, "/v3/dataforseo_labs/google/keyword_suggestions/live");
  assert.ok(
    results.every((endpoint) => {
      const text = JSON.stringify(endpoint).toLowerCase();
      return ["google", "keyword", "suggestions"].every((token) => text.includes(token));
    }),
  );

  const filtered = searchEndpoints("domain intersection", {
    family: "backlinks",
    method: "post",
    aiOptimized: true,
    limit: 10,
  });
  assert.ok(filtered.length > 0);
  assert.ok(
    filtered.every(
      ({ family, method, aiOptimized }) =>
        family === "backlinks" && method === "POST" && aiOptimized,
    ),
  );
  assert.deepEqual(searchEndpoints("keyword token-that-does-not-exist"), []);
});

test("resolver surfaces duplicate operationIds instead of guessing", () => {
  const ambiguous = resolveEndpoint("Errors");
  assert.equal(ambiguous.kind, "ambiguous");
  assert.deepEqual(
    ambiguous.candidates.map(({ id }) => id),
    ["GET /v3/appendix/errors", "POST /v3/serp/errors"],
  );

  const get = resolveEndpoint("Errors", "GET");
  assert.equal(get.kind, "match");
  assert.equal(get.endpoint.path, "/v3/appendix/errors");

  const post = resolveEndpoint("POST Errors");
  assert.equal(post.kind, "match");
  assert.equal(post.endpoint.path, "/v3/serp/errors");
});

test("resolver handles templates, concrete paths, URLs, and .ai", () => {
  const concrete = resolveEndpoint(
    "/v3/serp/google/organic/task_get/advanced/abc%20123",
  );
  assert.equal(concrete.kind, "match");
  assert.equal(concrete.matchedBy, "template");
  assert.equal(concrete.endpoint.path, "/v3/serp/google/organic/task_get/advanced/{id}");
  assert.deepEqual(concrete.pathValues, { id: "abc 123" });

  const upperCaseStaticPath = resolveEndpoint(
    "/V3/SERP/GOOGLE/ORGANIC/TASK_GET/ADVANCED/TaskAbC",
  );
  assert.equal(upperCaseStaticPath.kind, "match");
  assert.equal(
    upperCaseStaticPath.concretePath,
    "/v3/serp/google/organic/task_get/advanced/TaskAbC",
  );
  assert.deepEqual(upperCaseStaticPath.pathValues, { id: "TaskAbC" });

  const upperCaseExact = resolveEndpoint("/V3/SERP/GOOGLE/ORGANIC/LIVE/ADVANCED");
  assert.equal(upperCaseExact.kind, "match");
  assert.equal(upperCaseExact.concretePath, "/v3/serp/google/organic/live/advanced");

  const url = resolveEndpoint(
    "https://api.dataforseo.com/v3/serp/google/organic/task_get/advanced/demo.ai?ignored=1",
  );
  assert.equal(url.kind, "match");
  assert.equal(url.pathValues.id, "demo");

  const shortPath = resolveEndpoint("serp/google/organic/live/advanced");
  assert.equal(shortPath.kind, "match");
  assert.equal(shortPath.matchedBy, "path");

  assert.equal(resolveEndpoint("/v3/not/a/real/endpoint").kind, "not_found");
  assert.equal(resolveEndpoint("GET Errors", "POST").kind, "not_found");
});

test("describe output is ready for compact CLI rendering", () => {
  const resolution = resolveEndpoint("GoogleAdsSearchVolumeLive");
  assert.equal(resolution.kind, "match");
  const description = describeEndpoint(resolution.endpoint);

  assert.equal(description.id, resolution.endpoint.id);
  assert.equal(description.summary, resolution.endpoint.description);
  assert.equal(description.docs, resolution.endpoint.docsUrl);
  assert.equal(description.body.array, true);
  assert.equal(description.body.fields[0].name, "keywords");
});
