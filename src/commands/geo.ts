import { Command } from "commander";
import { call, CliError } from "../client";
import { emit, fail, outputOptions } from "../registry";
import { results } from "../trim";

// Location/language lists differ per API; --api picks which one to search.
const GEO_APIS: Record<string, { locations: string; languages?: string }> = {
  ads: { locations: "keywords_data/google_ads/locations", languages: "keywords_data/google_ads/languages" },
  serp: { locations: "serp/google/locations", languages: "serp/google/languages" },
  labs: { locations: "dataforseo_labs/locations_and_languages", languages: "dataforseo_labs/locations_and_languages" },
  trends: { locations: "keywords_data/google_trends/locations", languages: "keywords_data/google_trends/languages" },
  dfs_trends: { locations: "keywords_data/dataforseo_trends/locations" },
  bing: { locations: "keywords_data/bing/locations", languages: "keywords_data/bing/languages" },
  amazon: { locations: "merchant/amazon/locations", languages: "merchant/amazon/languages" },
  shopping: { locations: "merchant/google/locations", languages: "merchant/google/languages" },
  apple: { locations: "app_data/apple/locations", languages: "app_data/apple/languages" },
  google_play: { locations: "app_data/google/locations", languages: "app_data/google/languages" },
  business: { locations: "business_data/google/locations", languages: "business_data/google/languages" },
  tripadvisor: { locations: "business_data/tripadvisor/locations", languages: "business_data/tripadvisor/languages" },
  content: { locations: "content_analysis/locations", languages: "content_analysis/languages" },
  ai: { locations: "ai_optimization/ai_keyword_data/locations_and_languages", languages: "ai_optimization/ai_keyword_data/locations_and_languages" },
  llm_mentions: { locations: "ai_optimization/llm_mentions/locations_and_languages", languages: "ai_optimization/llm_mentions/locations_and_languages" },
  chatgpt: { locations: "ai_optimization/chat_gpt/llm_scraper/locations", languages: "ai_optimization/chat_gpt/llm_scraper/languages" },
};

const geoApi = (api: string) => {
  const g = GEO_APIS[api];
  if (!g) throw new CliError(`Unknown --api "${api}". Use one of: ${Object.keys(GEO_APIS).join(", ")}`);
  return g;
};

const TTL = 24 * 30;
const matches = (q: string | undefined, ...fields: any[]) =>
  !q || fields.some((f) => f !== undefined && f !== null && String(f).toLowerCase().includes(q.toLowerCase()));

export function registerGeo(program: Command): void {
  outputOptions(
    program
      .command("locations")
      .description("Location codes for -l/--location (free; lists differ per API, pick one with --api)")
      .argument("[search]", "Filter by name, country code or location code")
      .option("--api <api>", `Which API's list: ${Object.keys(GEO_APIS).join(", ")}`, "ads")
      .option("-n, --limit <n>", "Max rows", "50")
  ).action(async (search: string | undefined, opts: any) => {
    try {
      const { response } = await call(geoApi(opts.api).locations, undefined, { ttlHours: TTL });
      const rows = results(response)
        .filter((l) => matches(search, l.location_name, l.country_iso_code, l.location_code))
        .map((l) => ({ code: l.location_code, name: l.location_name, country: l.country_iso_code, type: l.location_type }));
      emit({ rows }, opts, parseInt(opts.limit));
    } catch (e) {
      fail(e);
    }
  });

  outputOptions(
    program
      .command("languages")
      .description("Language codes for --language (free; pick a list with --api)")
      .argument("[search]", "Filter by name or code")
      .option("--api <api>", "Which API's list (see locations --help)", "ads")
      .option("-n, --limit <n>", "Max rows", "50")
  ).action(async (search: string | undefined, opts: any) => {
    try {
      const g = geoApi(opts.api);
      if (!g.languages) throw new CliError(`--api ${opts.api} has no language list`);
      const { response } = await call(g.languages, undefined, { ttlHours: TTL });
      // locations_and_languages endpoints nest languages under each location
      const seen = new Map<string, { name: string; code: string }>();
      for (const l of results(response).flatMap((x: any) => (Array.isArray(x.available_languages) ? x.available_languages : [x]))) {
        if (l.language_code && !seen.has(l.language_code)) seen.set(l.language_code, { name: l.language_name, code: l.language_code });
      }
      const rows = [...seen.values()].filter((l) => matches(search, l.name, l.code));
      emit({ rows }, opts, parseInt(opts.limit));
    } catch (e) {
      fail(e);
    }
  });
}
