import { Command } from "commander";
import { Ctx, Mapped, register } from "../registry";
import { pick, trend } from "../map";
import { results } from "../trim";

const TTL = 24 * 30;

const adsCols = {
  keyword: "keyword",
  volume: "search_volume",
  cpc: "cpc",
  competition: "competition",
  comp_index: "competition_index",
  bid_low: "low_top_of_page_bid",
  bid_high: "high_top_of_page_bid",
  trend: (r: any) => trend(r.monthly_searches),
};

// Google Ads returns one result per keyword (no items wrapper); sort by volume.
function adsRows(resp: any, ctx: Ctx): Mapped {
  const rows = results(resp)
    .filter((r) => r.keyword)
    .sort((a, b) => (b.search_volume ?? -1) - (a.search_volume ?? -1))
    .map((r) => pick(r, adsCols, ctx));
  return { rows };
}

const note = " (Google Ads API: $0.09 per call live, cheaper with --queue)";

export function registerKeywords(program: Command): void {
  const g = program.command("keywords").description("Keywords Data API: Google Ads volumes and ideas, ad traffic forecasts, Bing volumes");

  register(g, {
    name: "volume",
    desc: "Google Ads search volume, CPC, competition and 12-month trend for up to 1000 keywords" + note,
    path: "keywords_data/google_ads/search_volume/live",
    args: ["<keywords...>"],
    limit: 100,
    apiLimit: false,
    ttl: TTL,
    columns: Object.keys(adsCols).join(", ") + " (trend = 12 monthly volumes, newest first)",
    body: ({ args }) => ({ keywords: args[0] }),
    map: adsRows,
  });

  register(g, {
    name: "for-site",
    desc: "Keyword ideas Google Ads associates with a domain or URL" + note,
    path: "keywords_data/google_ads/keywords_for_site/live",
    args: ["<target>"],
    options: [["--page", "Treat target as a single page instead of the whole site"]],
    limit: 50,
    apiLimit: false,
    ttl: TTL,
    columns: Object.keys(adsCols).join(", "),
    body: ({ args, opts }) => ({ target: args[0], target_type: opts.page ? "page" : "site" }),
    map: adsRows,
  });

  register(g, {
    name: "for-keywords",
    desc: "Google Ads keyword ideas for up to 20 seed keywords" + note,
    path: "keywords_data/google_ads/keywords_for_keywords/live",
    args: ["<keywords...>"],
    limit: 50,
    apiLimit: false,
    ttl: TTL,
    columns: Object.keys(adsCols).join(", "),
    body: ({ args }) => ({ keywords: args[0] }),
    map: adsRows,
  });

  register(g, {
    name: "ad-traffic",
    desc: "Google Ads traffic forecast (impressions, clicks, cost) for keywords at a max CPC bid" + note,
    path: "keywords_data/google_ads/ad_traffic_by_keywords/live",
    args: ["<keywords...>"],
    options: [
      ["--bid <usd>", "Max CPC bid", "5"],
      ["--match <type>", "exact, broad or phrase", "exact"],
    ],
    limit: 100,
    apiLimit: false,
    ttl: TTL,
    columns: "keyword, impressions, clicks, ctr, avg_cpc, cost",
    body: ({ args, opts }) => ({ keywords: args[0], bid: parseFloat(opts.bid), match: opts.match }),
    map: (resp, ctx) => ({
      rows: results(resp).map((r) =>
        // A null keyword means the forecast covers the whole keyword set
        pick(r, { keyword: (x: any) => x.keyword ?? ctx.args[0].join(", "), impressions: "impressions", clicks: "clicks", ctr: "ctr", avg_cpc: "average_cpc", cost: "cost" }, ctx)
      ),
    }),
  });

  register(g, {
    name: "bing-volume",
    desc: "Bing search volume, CPC and competition (Bing Ads API: $0.09 per call)",
    path: "keywords_data/bing/search_volume/live",
    args: ["<keywords...>"],
    limit: 100,
    apiLimit: false,
    ttl: TTL,
    columns: "keyword, volume, cpc, competition, trend",
    body: ({ args }) => ({ keywords: args[0] }),
    map: (resp, ctx) => ({
      rows: results(resp).map((r) =>
        pick(r, { keyword: "keyword", volume: "search_volume", cpc: "cpc", competition: "competition", trend: (x: any) => trend(x.monthly_searches) }, ctx)
      ),
    }),
  });
}
