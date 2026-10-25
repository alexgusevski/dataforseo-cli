import { Command } from "commander";
import { Ctx, Mapped, register, TypedCommand } from "../registry";
import { domainOf, fromItems, get, pick, trend } from "../map";
import { items } from "../trim";

const TTL = 24 * 30;
const L = "dataforseo_labs/google";

// Columns for items shaped like keyword_ideas / keyword_suggestions (keyword at top level)
// or related_keywords / ranked_keywords (wrapped in keyword_data).
function kwCols(prefix = "") {
  const p = (s: string) => (prefix ? `${prefix}.${s}` : s);
  return {
    keyword: p("keyword"),
    volume: p("keyword_info.search_volume"),
    cpc: p("keyword_info.cpc"),
    competition: p("keyword_info.competition_level"),
    difficulty: p("keyword_properties.keyword_difficulty"),
    intent: p("search_intent_info.main_intent"),
  };
}

const orderBy = (field: string): [string, string, string?] => [
  "--order <field,dir>",
  `Sort, e.g. "${field},desc"`,
  `${field},desc`,
];

const order = (o: any) => (o.order ? { order_by: [o.order] } : {});

function labsCmd(def: Omit<TypedCommand, "ttl"> & { ttl?: number }): TypedCommand {
  return { ttl: TTL, limit: 20, ...def };
}

// Organic metrics block used by domain-level endpoints.
const organic = (base: string) => ({
  keywords: `${base}.organic.count`,
  etv: `${base}.organic.etv`,
  traffic_cost: `${base}.organic.estimated_paid_traffic_cost`,
  top3: (i: any) => sum(get(i, base)?.organic, ["pos_1", "pos_2_3"]),
  top10: (i: any) => sum(get(i, base)?.organic, ["pos_1", "pos_2_3", "pos_4_10"]),
});

function sum(o: any, keys: string[]): number | "" {
  if (!o) return "";
  return keys.reduce((a, k) => a + (o[k] || 0), 0);
}

export function registerLabs(program: Command): void {
  const g = program.command("labs").description("DataForSEO Labs: keyword ideas, difficulty, intent, domain rankings, competitors, traffic; Amazon keywords");

  const kwListCols = "keyword, volume, cpc, competition, difficulty, intent";

  register(g, labsCmd({
    name: "ideas",
    desc: "Keyword ideas from the product/service category of seed keywords",
    path: `${L}/keyword_ideas/live`,
    args: ["<keywords...>"],
    options: [orderBy("keyword_info.search_volume")],
    columns: kwListCols,
    body: ({ args, opts }) => ({ keywords: args[0], ...order(opts) }),
    map: fromItems(kwCols()),
  }));

  register(g, labsCmd({
    name: "suggestions",
    desc: "Long-tail keywords that contain the seed keyword",
    path: `${L}/keyword_suggestions/live`,
    args: ["<keyword>"],
    options: [orderBy("keyword_info.search_volume")],
    columns: kwListCols,
    body: ({ args, opts }) => ({ keyword: args[0], ...order(opts) }),
    map: fromItems(kwCols()),
  }));

  register(g, labsCmd({
    name: "related",
    desc: "Related keywords from Google's 'searches related to' graph",
    path: `${L}/related_keywords/live`,
    args: ["<keyword>"],
    options: [["--depth <n>", "Graph depth 0-4", "1"], orderBy("keyword_data.keyword_info.search_volume")],
    columns: kwListCols + ", depth",
    body: ({ args, opts }) => ({ keyword: args[0], depth: parseInt(opts.depth), ...order(opts) }),
    map: fromItems({ ...kwCols("keyword_data"), depth: "depth" }),
  }));

  register(g, labsCmd({
    name: "overview",
    desc: "Full keyword overview: volume, CPC, difficulty, intent, SERP features, 12-month trend",
    path: `${L}/keyword_overview/live`,
    args: ["<keywords...>"],
    maxBatch: 700,
    perKeyword: true,
    limit: 100,
    apiLimit: false,
    columns: kwListCols + ", serp_features, trend",
    body: ({ args }) => ({ keywords: args[0] }),
    map: fromItems({ ...kwCols(), serp_features: "serp_info.serp_item_types", trend: (i: any) => trend(i.keyword_info?.monthly_searches) }),
  }));

  register(g, labsCmd({
    name: "difficulty",
    desc: "Bulk keyword difficulty (0-100) for up to 1000 keywords",
    path: `${L}/bulk_keyword_difficulty/live`,
    args: ["<keywords...>"],
    maxBatch: 1000,
    perKeyword: true,
    limit: 100,
    apiLimit: false,
    columns: "keyword, difficulty",
    body: ({ args }) => ({ keywords: args[0] }),
    map: fromItems({ keyword: "keyword", difficulty: "keyword_difficulty" }),
  }));

  register(g, labsCmd({
    name: "intent",
    desc: "Search intent (informational, navigational, commercial, transactional) for up to 1000 keywords",
    path: `${L}/search_intent/live`,
    args: ["<keywords...>"],
    maxBatch: 1000,
    perKeyword: true,
    limit: 100,
    apiLimit: false,
    geo: "full",
    columns: "keyword, intent, probability, secondary",
    body: ({ args }) => ({ keywords: args[0] }),
    map: fromItems({
      keyword: "keyword",
      intent: "keyword_intent.label",
      probability: "keyword_intent.probability",
      secondary: (i: any) => (i.secondary_keyword_intents || []).map((s: any) => s.label).join(","),
    }),
  }));

  register(g, labsCmd({
    name: "history",
    desc: "Historical monthly search volume per keyword (one column per month)",
    path: `${L}/historical_search_volume/live`,
    args: ["<keywords...>"],
    maxBatch: 700,
    perKeyword: true,
    options: [["--months <n>", "Months to show, newest first", "12"]],
    limit: 100,
    apiLimit: false,
    columns: "keyword, volume, <YYYY-MM>...",
    body: ({ args }) => ({ keywords: args[0] }),
    map: (resp: any, ctx: Ctx): Mapped => ({
      rows: items(resp).map((i) => {
        const row: Record<string, any> = { keyword: i.keyword, volume: i.keyword_info?.search_volume ?? "" };
        const months = [...(i.keyword_info?.monthly_searches || [])].sort((a, b) => b.year - a.year || b.month - a.month);
        for (const m of months.slice(0, parseInt(ctx.opts.months))) {
          row[`${m.year}-${String(m.month).padStart(2, "0")}`] = m.search_volume ?? "";
        }
        return row;
      }),
    }),
  }));

  register(g, labsCmd({
    name: "ranked",
    desc: "Keywords a domain or URL ranks for, with position, volume and estimated traffic",
    path: `${L}/ranked_keywords/live`,
    args: ["<target>"],
    options: [orderBy("keyword_data.keyword_info.search_volume")],
    columns: "keyword, pos, volume, cpc, difficulty, intent, etv, type, url",
    body: ({ args, opts }) => ({ target: args[0], ...order(opts) }),
    map: fromItems({
      keyword: "keyword_data.keyword",
      pos: "ranked_serp_element.serp_item.rank_group",
      volume: "keyword_data.keyword_info.search_volume",
      cpc: "keyword_data.keyword_info.cpc",
      difficulty: "keyword_data.keyword_properties.keyword_difficulty",
      intent: "keyword_data.search_intent_info.main_intent",
      etv: "ranked_serp_element.serp_item.etv",
      type: "ranked_serp_element.serp_item.type",
      url: "ranked_serp_element.serp_item.url",
    }),
  }));

  register(g, labsCmd({
    name: "domain-overview",
    aliases: ["overview-domain"],
    desc: "Domain ranking overview: organic keywords, traffic estimate, top-3/top-10 counts, paid keywords",
    path: `${L}/domain_rank_overview/live`,
    args: ["<target>"],
    limit: 0,
    apiLimit: false,
    columns: "target, keywords, etv, traffic_cost, top3, top10, new, lost, paid_keywords, paid_etv",
    body: ({ args }) => ({ target: args[0] }),
    map: (resp: any, ctx: Ctx) => ({
      rows: items(resp).map((i) =>
        pick(i, {
          target: () => ctx.args[0],
          ...organic("metrics"),
          new: "metrics.organic.is_new",
          lost: "metrics.organic.is_lost",
          paid_keywords: "metrics.paid.count",
          paid_etv: "metrics.paid.etv",
        }, ctx)
      ),
    }),
  }));

  register(g, labsCmd({
    name: "competitors",
    desc: "Organic competitor domains of a domain (shared keywords, their size)",
    path: `${L}/competitors_domain/live`,
    args: ["<target>"],
    columns: "domain, shared, avg_pos, keywords, etv",
    body: ({ args }) => ({ target: args[0], exclude_top_domains: true }),
    map: (resp: any, ctx: Ctx) => {
      const m = fromItems({
        domain: "domain",
        shared: "intersections",
      avg_pos: "avg_position",
      keywords: "full_domain_metrics.organic.count",
        etv: "full_domain_metrics.organic.etv",
      })(resp, ctx);
      // the target itself comes back as its own top "competitor"
      return { ...m, rows: m.rows.filter((r) => r.domain !== String(ctx.args[0]).replace(/^www\./, "")) };
    },
  }));

  register(g, labsCmd({
    name: "intersection",
    desc: "Keywords two domains both rank for (or --gap: keywords only the first ranks for)",
    path: `${L}/domain_intersection/live`,
    args: ["<target1>", "<target2>"],
    options: [["--gap", "Keywords target1 ranks for and target2 does not"], orderBy("keyword_data.keyword_info.search_volume")],
    columns: "keyword, volume, difficulty, pos1, pos2, url1, url2",
    body: ({ args, opts }) => ({ target1: args[0], target2: args[1], intersections: !opts.gap, ...order(opts) }),
    map: fromItems({
      keyword: "keyword_data.keyword",
      volume: "keyword_data.keyword_info.search_volume",
      difficulty: "keyword_data.keyword_properties.keyword_difficulty",
      pos1: "first_domain_serp_element.rank_group",
      pos2: "second_domain_serp_element.rank_group",
      url1: "first_domain_serp_element.url",
      url2: "second_domain_serp_element.url",
    }),
  }));

  register(g, labsCmd({
    name: "serp-competitors",
    desc: "Domains that rank for a set of keywords (who owns this topic)",
    path: `${L}/serp_competitors/live`,
    args: ["<keywords...>"],
    columns: "domain, keywords, avg_pos, median_pos, etv, visibility",
    body: ({ args }) => ({ keywords: args[0] }),
    map: fromItems({
      domain: (i: any) => domainOf(i.domain),
      keywords: "keywords_count",
      avg_pos: "avg_position",
      median_pos: "median_position",
      etv: "etv",
      visibility: "visibility",
    }),
  }));

  register(g, labsCmd({
    name: "traffic",
    desc: "Bulk organic/paid traffic estimate for up to 1000 domains or URLs",
    path: `${L}/bulk_traffic_estimation/live`,
    args: ["<targets...>"],
    maxBatch: 1000,
    limit: 100,
    apiLimit: false,
    columns: "target, etv, keywords, paid_etv, paid_keywords",
    body: ({ args }) => ({ targets: args[0] }),
    map: fromItems({
      target: "target",
      etv: "metrics.organic.etv",
      keywords: "metrics.organic.count",
      paid_etv: "metrics.paid.etv",
      paid_keywords: "metrics.paid.count",
    }),
  }));

  register(g, labsCmd({
    name: "pages",
    desc: "A domain's pages ranked by organic traffic (relevant pages)",
    path: `${L}/relevant_pages/live`,
    args: ["<target>"],
    columns: "url, keywords, etv, top3, top10",
    body: ({ args }) => ({ target: args[0] }),
    map: fromItems({ url: "page_address", ...organic("metrics") }),
  }));

  register(g, labsCmd({
    name: "site-keywords",
    desc: "Keywords relevant to a domain (Labs keywords_for_site)",
    path: `${L}/keywords_for_site/live`,
    args: ["<target>"],
    options: [orderBy("keyword_info.search_volume")],
    columns: kwListCols,
    body: ({ args, opts }) => ({ target: args[0], ...order(opts) }),
    map: fromItems(kwCols()),
  }));

  register(g, labsCmd({
    name: "top-searches",
    desc: "Top keywords in the Labs database for a location (filter with --param filters='[...]')",
    path: `${L}/top_searches/live`,
    options: [orderBy("keyword_info.search_volume")],
    columns: kwListCols,
    body: ({ opts }) => ({ ...order(opts) }),
    map: fromItems(kwCols()),
  }));

  // Amazon keyword research (Labs Amazon). Amazon uses language_code like en_US only on Merchant; Labs uses en.
  register(g, labsCmd({
    name: "amazon-volume",
    desc: "Amazon search volume for up to 1000 keywords",
    path: "dataforseo_labs/amazon/bulk_search_volume/live",
    args: ["<keywords...>"],
    maxBatch: 1000,
    perKeyword: true,
    limit: 100,
    apiLimit: false,
    columns: "keyword, volume",
    body: ({ args }) => ({ keywords: args[0] }),
    map: fromItems({ keyword: "keyword", volume: "search_volume" }),
  }));

  register(g, labsCmd({
    name: "amazon-related",
    desc: "Related Amazon keywords for a seed keyword",
    path: "dataforseo_labs/amazon/related_keywords/live",
    args: ["<keyword>"],
    options: [["--depth <n>", "Graph depth 0-4", "1"]],
    columns: "keyword, volume, depth",
    body: ({ args, opts }) => ({ keyword: args[0], depth: parseInt(opts.depth) }),
    map: fromItems({ keyword: "keyword_data.keyword", volume: "keyword_data.keyword_info.search_volume", depth: "depth" }),
  }));

  register(g, labsCmd({
    name: "amazon-ranked",
    desc: "Amazon keywords a product (ASIN) ranks for",
    path: "dataforseo_labs/amazon/ranked_keywords/live",
    args: ["<asin>"],
    columns: "keyword, pos, volume, type",
    body: ({ args }) => ({ asin: args[0] }),
    map: fromItems({
      keyword: "keyword_data.keyword",
      pos: "ranked_serp_element.serp_item.rank_group",
      volume: "keyword_data.keyword_info.search_volume",
      type: "ranked_serp_element.serp_item.type",
    }),
  }));

  register(g, labsCmd({
    name: "amazon-competitors",
    desc: "Products (ASINs) competing with an ASIN for the same Amazon keywords",
    path: "dataforseo_labs/amazon/product_competitors/live",
    args: ["<asin>"],
    columns: "asin, shared, avg_pos, keywords",
    body: ({ args }) => ({ asin: args[0] }),
    map: (resp: any, ctx: Ctx) =>
      fromItems({ asin: "asin", shared: "intersections", avg_pos: "avg_position", keywords: "full_metrics.amazon_serp.count|metrics.amazon_serp.count" })(resp, ctx),
  }));
}

