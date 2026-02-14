import { getAuthHeader } from "./config";
import * as cache from "./cache";

const BASE = "https://api.dataforseo.com/v3";

async function request(path: string, body?: unknown): Promise<any> {
  const opts: RequestInit = {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);
  const data: any = await res.json();

  if (data.status_code !== 20000) {
    throw new Error(`API error ${data.status_code}: ${data.status_message}`);
  }

  const task = data.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    throw new Error(
      `Task error ${task?.status_code}: ${task?.status_message}`
    );
  }

  return task.result;
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
