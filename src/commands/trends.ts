import { Command } from "commander";
import { Ctx, Mapped, register } from "../registry";
import { items, Row } from "../trim";

const TTL = 24;
const SECTIONS = ["time", "regions", "queries", "topics"];

const rangeOpt: [string, string, string?] = [
  "--time-range <range>",
  "past_hour, past_4_hours, past_day, past_7_days, past_30_days, past_90_days, past_12_months, past_5_years",
  "past_12_months",
];

// Weekly points become monthly averages unless --weekly, so a year is 12 rows, not 52.
function timeRows(points: any[], keywords: string[], weekly: boolean): Row[] {
  const rows: Row[] = points
    .filter((p) => !p.missing_data)
    .map((p) => {
      const row: Row = { date: String(p.date_from || p.date || "").slice(0, 10) };
      keywords.forEach((k, i) => (row[k] = p.values?.[i] ?? ""));
      return row;
    });
  const spanDays = rows.length > 1 ? (Date.parse(rows[rows.length - 1].date) - Date.parse(rows[0].date)) / 864e5 : 0;
  if (weekly || rows.length <= 26 || spanDays / rows.length < 6) return rows;
  const months = new Map<string, { n: number; sums: number[] }>();
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    const acc = months.get(m) || { n: 0, sums: keywords.map(() => 0) };
    acc.n++;
    keywords.forEach((k, i) => (acc.sums[i] += Number(r[k]) || 0));
    months.set(m, acc);
  }
  return [...months.entries()].map(([m, acc]) => {
    const row: Row = { date: m };
    keywords.forEach((k, i) => (row[k] = Math.round(acc.sums[i] / acc.n)));
    return row;
  });
}

function listRows(it: any, field: "query" | "topic_title"): Row[] {
  const rows: Row[] = [];
  const kw = (it.keywords || []).join("+");
  for (const kind of ["top", "rising"]) {
    for (const x of it.data?.[kind] || []) {
      rows.push({
        keyword: kw,
        kind,
        [field === "query" ? "query" : "topic"]: x[field],
        ...(field === "topic_title" && x.topic_type ? { topic_type: x.topic_type } : {}),
        value: x.value,
      });
    }
  }
  return rows;
}

export function trendsSections(resp: any, ctx: Ctx): Mapped {
  const view = String(ctx.opts.view || "all");
  const want = view === "all" ? SECTIONS : view.split(",");
  const out: Record<string, Row[]> = { time: [], regions: [], queries: [], topics: [] };
  for (const it of items(resp)) {
    const kws: string[] = it.keywords || [];
    if (/graph$/.test(it.type) && Array.isArray(it.data)) out.time.push(...timeRows(it.data, kws, !!ctx.opts.weekly));
    else if (/map$|subregion/.test(it.type)) {
      for (const r of it.data || it.interests || []) {
        const row: Row = { region: r.geo_name };
        kws.forEach((k, i) => (row[k] = r.values?.[i] ?? r.value ?? ""));
        out.regions.push(row);
      }
    } else if (/queries_list$/.test(it.type)) out.queries.push(...listRows(it, "query"));
    else if (/topics_list$/.test(it.type)) out.topics.push(...listRows(it, "topic_title"));
  }
  return { rows: [], sections: SECTIONS.filter((s) => want.includes(s)).map((s) => ({ name: s, rows: out[s] })) };
}

export function registerTrends(program: Command): void {
  const g = program.command("trends").description("Google Trends and DataForSEO Trends: interest over time, regions, related queries and topics");

  register(g, {
    name: "google",
    aliases: ["explore"],
    desc: "Google Trends explore: interest over time (monthly), regions, related queries and topics (up to 5 keywords)",
    path: "keywords_data/google_trends/explore/live",
    args: ["<keywords...>"],
    options: [
      rangeOpt,
      ["--type <type>", "web, news, youtube, images, froogle (shopping)", "web"],
      ["--view <list>", "Sections: all or any of time,regions,queries,topics", "all"],
      ["--weekly", "Keep weekly points instead of monthly averages"],
    ],
    limit: 25,
    apiLimit: false,
    ttl: TTL,
    columns: "time: date, <keyword>...; regions: region, <keyword>...; queries: keyword, kind (top|rising), query, value; topics: keyword, kind, topic, topic_type, value",
    body: ({ args, opts }) => ({
      keywords: args[0],
      time_range: opts.timeRange,
      type: opts.type,
      item_types: ["google_trends_graph", "google_trends_map", "google_trends_queries_list", "google_trends_topics_list"],
    }),
    map: trendsSections,
  });

  register(g, {
    name: "dfs",
    desc: "DataForSEO Trends explore: interest over time from DataForSEO's own clickstream (cheaper; up to 5 keywords)",
    path: "keywords_data/dataforseo_trends/explore/live",
    args: ["<keywords...>"],
    geo: "location",
    options: [rangeOpt, ["--type <type>", "web, news, ecommerce", "web"], ["--weekly", "Keep weekly points"]],
    limit: 60,
    apiLimit: false,
    ttl: TTL,
    columns: "date, <keyword>...",
    body: ({ args, opts }) => ({ keywords: args[0], time_range: opts.timeRange, type: opts.type }),
    map: (resp, ctx) => ({ rows: trendsSections(resp, { ...ctx, opts: { ...ctx.opts, view: "time" } }).sections![0].rows }),
  });

  register(g, {
    name: "regions",
    desc: "DataForSEO Trends interest by subregion",
    path: "keywords_data/dataforseo_trends/subregion_interests/live",
    args: ["<keywords...>"],
    geo: "location",
    options: [rangeOpt, ["--type <type>", "web, news, ecommerce", "web"]],
    limit: 30,
    apiLimit: false,
    ttl: TTL,
    columns: "region, <keyword>...",
    body: ({ args, opts }) => ({ keywords: args[0], time_range: opts.timeRange, type: opts.type }),
    map: (resp, ctx) => ({ rows: trendsSections(resp, { ...ctx, opts: { ...ctx.opts, view: "regions" } }).sections![0].rows }),
  });
}
