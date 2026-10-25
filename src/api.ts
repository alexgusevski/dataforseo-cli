import * as cache from "./cache";
import { call } from "./client";

// Legacy commands keep their own per-keyword cache, so the request cache is off here
// (except for the free location/language lists).
async function request(path: string, body?: unknown): Promise<any> {
  const ttlHours = body ? 0 : 24 * 30;
  const { response } = await call(path, body, { ttlHours });
  return response.tasks[0].result;
}

export interface VolumeResult {
  keyword: string;
  volume: number;
  cpc: number;
  competition: string;
  difficulty: number | null;
  trend: number[];
}

export async function searchVolume(
  keywords: string[],
  locationCode: number,
  languageCode: string
): Promise<VolumeResult[]> {
  // Check cache per keyword
  const cached: VolumeResult[] = [];
  const uncached: string[] = [];

  for (const kw of keywords) {
    const key = cache.makeKey("volume", kw, locationCode, languageCode);
    const hit = cache.get(key);
    if (hit) {
      cached.push(hit);
    } else {
      uncached.push(kw);
    }
  }

  if (uncached.length === 0) return cached;

  // Fetch uncached keywords
  const volResult = await request(
    "/keywords_data/google_ads/search_volume/live",
    [{ keywords: uncached, location_code: locationCode, language_code: languageCode }]
  );

  let difficultyMap = new Map<string, number>();
  try {
    const diffResult = await request(
      "/dataforseo_labs/google/bulk_keyword_difficulty/live",
      [{ keywords: uncached, location_code: locationCode, language_code: languageCode }]
    );
    if (diffResult?.[0]?.items) {
      for (const item of diffResult[0].items) {
        difficultyMap.set(item.keyword, item.keyword_difficulty ?? null);
      }
    }
  } catch {
    // difficulty is optional
  }

  const results: any[] = Array.isArray(volResult)
    ? volResult
    : volResult?.[0]?.items || [];

  const fresh: VolumeResult[] = results.map((r: any) => ({
    keyword: r.keyword,
    volume: r.search_volume ?? 0,
    cpc: r.cpc ?? 0,
    competition: r.competition ?? "UNKNOWN",
    difficulty: difficultyMap.get(r.keyword) ?? null,
    trend: (r.monthly_searches || []).slice(0, 12).map((m: any) => m.search_volume),
  }));

  // Cache each keyword individually
  for (const item of fresh) {
    const key = cache.makeKey("volume", item.keyword, locationCode, languageCode);
    cache.set(key, item);
  }

  // Return in original keyword order
  const allMap = new Map<string, VolumeResult>();
  for (const r of [...cached, ...fresh]) allMap.set(r.keyword.toLowerCase(), r);
  return keywords.map((kw) => allMap.get(kw.toLowerCase())!).filter(Boolean);
}

export interface RelatedResult {
  keyword: string;
  volume: number;
  cpc: number;
  competition: number;
  difficulty: number | null;
}

export async function relatedKeywords(
  seed: string,
  locationCode: number,
  languageCode: string,
  limit: number = 50
): Promise<RelatedResult[]> {
  const key = cache.makeKey("related", `${seed}:${limit}`, locationCode, languageCode);
  const hit = cache.get(key);
  if (hit) return hit;

  const result = await request(
    "/dataforseo_labs/google/keyword_suggestions/live",
    [
      {
        keyword: seed,
        location_code: locationCode,
        language_code: languageCode,
        limit,
        include_seed_keyword: false,
      },
    ]
  );

  const items = result?.[0]?.items || [];
  const data: RelatedResult[] = items.map((item: any) => ({
    keyword: item.keyword,
    volume: item.keyword_info?.search_volume ?? 0,
    cpc: item.keyword_info?.cpc ?? 0,
    competition: item.keyword_info?.competition ?? 0,
    difficulty: item.keyword_properties?.keyword_difficulty ?? null,
  }));

  cache.set(key, data);

  // Cross-populate volume cache with keyword data we already have
  for (const item of data) {
    const volKey = cache.makeKey("volume", item.keyword, locationCode, languageCode);
    if (!cache.get(volKey)) {
      cache.set(volKey, {
        keyword: item.keyword,
        volume: item.volume,
        cpc: item.cpc,
        competition: String(item.competition),
        difficulty: item.difficulty,
        trend: [],
      } as VolumeResult);
    }
  }

  return data;
}

export interface CompetitorResult {
  keyword: string;
  position: number;
  volume: number;
  cpc: number;
  difficulty: number | null;
  url: string;
}

export async function competitorKeywords(
  domain: string,
  locationCode: number,
  languageCode: string,
  limit: number = 50
): Promise<CompetitorResult[]> {
  const key = cache.makeKey("competitor", `${domain}:${limit}`, locationCode, languageCode);
  const hit = cache.get(key);
  if (hit) return hit;

  const result = await request(
    "/dataforseo_labs/google/ranked_keywords/live",
    [
      {
        target: domain,
        location_code: locationCode,
        language_code: languageCode,
        limit,
      },
    ]
  );

  const items = result?.[0]?.items || [];
  const data: CompetitorResult[] = items.map((item: any) => ({
    keyword: item.keyword_data?.keyword ?? "",
    position: item.ranked_serp_element?.serp_item?.rank_group ?? 0,
    volume: item.keyword_data?.keyword_info?.search_volume ?? 0,
    cpc: item.keyword_data?.keyword_info?.cpc ?? 0,
    difficulty: item.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
    url: item.ranked_serp_element?.serp_item?.url ?? "",
  }));

  cache.set(key, data);

  // Cross-populate volume cache
  for (const item of data) {
    if (!item.keyword) continue;
    const volKey = cache.makeKey("volume", item.keyword, locationCode, languageCode);
    if (!cache.get(volKey)) {
      cache.set(volKey, {
        keyword: item.keyword,
        volume: item.volume,
        cpc: item.cpc,
        competition: "",
        difficulty: item.difficulty,
        trend: [],
      } as VolumeResult);
    }
  }

  return data;
}

export interface LocationResult {
  code: number;
  name: string;
  country: string;
  type: string;
}

export async function locations(search?: string): Promise<LocationResult[]> {
  const result = await request("/keywords_data/google_ads/locations");
  let items: any[] = result || [];

  if (search) {
    const q = search.toLowerCase();
    items = items.filter(
      (l: any) =>
        l.location_name?.toLowerCase().includes(q) ||
        l.country_iso_code?.toLowerCase().includes(q)
    );
  }

  return items.slice(0, 50).map((l: any) => ({
    code: l.location_code,
    name: l.location_name,
    country: l.country_iso_code,
    type: l.location_type,
  }));
}

export interface LanguageResult {
  name: string;
  code: string;
}

export async function languages(search?: string): Promise<LanguageResult[]> {
  const result = await request("/keywords_data/google_ads/languages");
  let items: any[] = result || [];

  if (search) {
    const q = search.toLowerCase();
    items = items.filter(
      (l: any) =>
        l.language_name?.toLowerCase().includes(q) ||
        l.language_code?.toLowerCase().includes(q)
    );
  }

  return items.map((l: any) => ({
    name: l.language_name,
    code: l.language_code,
  }));
}

// Location/language lists differ per API; --api picks which one to search.
export const GEO_APIS: Record<string, { locations: string; languages?: string }> = {
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

function geoApi(api: string) {
  const g = GEO_APIS[api];
  if (!g) throw new Error(`Unknown --api "${api}". Use one of: ${Object.keys(GEO_APIS).join(", ")}`);
  return g;
}

export async function apiLocations(api: string, search?: string): Promise<LocationResult[]> {
  let items: any[] = (await request(geoApi(api).locations)) || [];
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(
      (l: any) =>
        l.location_name?.toLowerCase().includes(q) ||
        l.country_iso_code?.toLowerCase().includes(q) ||
        String(l.location_code) === q
    );
  }
  return items.slice(0, 50).map((l: any) => ({
    code: l.location_code,
    name: l.location_name,
    country: l.country_iso_code,
    type: l.location_type,
  }));
}

export async function apiLanguages(api: string, search?: string): Promise<LanguageResult[]> {
  const g = geoApi(api);
  if (!g.languages) throw new Error(`--api ${api} has no language list`);
  const raw: any[] = (await request(g.languages)) || [];
  // locations_and_languages endpoints nest languages under each location
  const flat: any[] = raw.flatMap((l: any) => (Array.isArray(l.available_languages) ? l.available_languages : [l]));
  const seen = new Map<string, LanguageResult>();
  for (const l of flat) {
    if (l.language_code && !seen.has(l.language_code)) seen.set(l.language_code, { name: l.language_name, code: l.language_code });
  }
  let items = [...seen.values()];
  if (search) {
    const q = search.toLowerCase();
    items = items.filter((l) => l.name?.toLowerCase().includes(q) || l.code?.toLowerCase().includes(q));
  }
  return items;
}
