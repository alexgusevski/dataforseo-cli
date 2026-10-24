import { Command } from "commander";
import { Ctx, Mapped, register } from "../registry";
import { date, fromItems, list, pick } from "../map";
import { items, results, Row } from "../trim";

const TTL = 72;

// "anger:12, joy:40" style summaries of count maps, biggest first.
function counts(obj: any, n = 5): string {
  if (!obj || typeof obj !== "object") return "";
  return list(
    Object.entries(obj)
      .filter(([, v]) => typeof v === "number" && v > 0)
      .sort((a: any, b: any) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`),
    n,
    ", "
  );
}

const topDomains = (r: any) => list((r.top_domains || []).map((d: any) => `${d.domain}:${d.count}`), 5, ", ");

const keywordBody = (extra: (o: any) => Record<string, any> = () => ({})) =>
  ({ args, opts }: Ctx) => ({ keyword: args[0], ...extra(opts) });

export function registerContent(program: Command): void {
  const g = program
    .command("content-analysis")
    .alias("content")
    .description("Content Analysis API: web mentions of a keyword or brand, sentiment, phrase trends");

  register(g, {
    name: "search",
    desc: "Pages that mention a keyword or brand, with sentiment",
    path: "content_analysis/search/live",
    args: ["<keyword>"],
    geo: "none",
    options: [["--page-type <type>", "ecommerce, news, blogs, message-boards, organization"]],
    limit: 20,
    ttl: TTL,
    columns: "date, domain, title, url, sentiment, snippet",
    body: keywordBody((o) => (o.pageType ? { page_type: [o.pageType] } : {})),
    map: fromItems({
      date: (i: any) => date(i.content_info?.date_published || i.fetch_time),
      domain: "domain",
      title: "content_info.main_title|content_info.title",
      url: "url",
      sentiment: (i: any) => counts(i.content_info?.connotation_types, 1).split(":")[0],
      snippet: "content_info.snippet",
    }),
  });

  register(g, {
    name: "summary",
    desc: "Overview of mentions: total, sentiment split, top domains, countries, categories",
    path: "content_analysis/summary/live",
    args: ["<keyword>"],
    geo: "none",
    limit: 0,
    apiLimit: false,
    ttl: TTL,
    columns: "keyword, mentions, sentiment, emotions, top_domains, countries, languages, page_types",
    body: keywordBody(),
    map: (resp: any, ctx: Ctx): Mapped => ({
      rows: results(resp).map((r) =>
        pick(r, {
          keyword: () => ctx.args[0],
          mentions: "total_count",
          sentiment: (x: any) => counts(x.connotation_types),
          emotions: (x: any) => counts(x.sentiment_connotations),
          top_domains: topDomains,
          countries: (x: any) => counts(x.countries),
          languages: (x: any) => counts(x.languages, 3),
          page_types: (x: any) => counts(x.page_types, 4),
        }, ctx)
      ),
    }),
  });

  register(g, {
    name: "sentiment",
    desc: "Mentions per sentiment (positive/negative/neutral) and emotion, with top domains",
    path: "content_analysis/sentiment_analysis/live",
    args: ["<keyword>"],
    geo: "none",
    limit: 0,
    apiLimit: false,
    ttl: TTL,
    columns: "kind (sentiment|emotion), label, mentions, top_domains",
    body: keywordBody(),
    map: (resp: any): Mapped => {
      const rows: Row[] = [];
      for (const r of results(resp)) {
        for (const [kind, field] of [["sentiment", "positive_connotation_distribution"], ["emotion", "sentiment_connotation_distribution"]]) {
          for (const [label, v] of Object.entries<any>(r[field] || {})) {
            if (!v) continue;
            rows.push({ kind, label, mentions: v.total_count ?? "", top_domains: topDomains(v) });
          }
        }
      }
      return { rows };
    },
  });

  register(g, {
    name: "phrase-trends",
    desc: "Mentions of a keyword over time with sentiment",
    path: "content_analysis/phrase_trends/live",
    args: ["<keyword>"],
    geo: "none",
    options: [
      ["--from <date>", "Start date YYYY-MM-DD (default: one year ago)"],
      ["--group <by>", "day, week or month", "month"],
    ],
    limit: 0,
    apiLimit: false,
    ttl: TTL,
    columns: "date, mentions, sentiment, top_domains",
    body: keywordBody((o) => ({
      date_from: o.from || new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10),
      date_group: o.group,
    })),
    map: (resp: any, ctx: Ctx): Mapped => ({
      rows: items(resp).map((i) =>
        pick(i, { date: (x: any) => date(x.date), mentions: "total_count", sentiment: (x: any) => counts(x.connotation_types), top_domains: topDomains }, ctx)
      ),
    }),
  });
}

export function registerDomain(program: Command): void {
  const g = program.command("domain-analytics").alias("domain").description("Domain Analytics API: technology stack and WHOIS");

  register(g, {
    name: "tech",
    aliases: ["technologies"],
    desc: "Technologies a website uses (CMS, analytics, ecommerce, payment...)",
    path: "domain_analytics/technologies/domain_technologies/live",
    args: ["<domain>"],
    geo: "none",
    limit: 0,
    apiLimit: false,
    ttl: 24 * 30,
    columns: "group, category, technologies",
    body: ({ args }) => ({ target: args[0] }),
    map: (resp: any): Mapped => {
      const rows: Row[] = [];
      for (const r of results(resp)) {
        for (const [group, cats] of Object.entries<any>(r.technologies || {})) {
          for (const [category, techs] of Object.entries<any>(cats || {})) {
            rows.push({ group, category, technologies: (techs || []).join(", ") });
          }
        }
      }
      return { rows };
    },
  });

  register(g, {
    name: "whois",
    desc: "WHOIS overview with SEO metrics for one or more domains ($0.12 per call)",
    path: "domain_analytics/whois/overview/live",
    args: ["<domains...>"],
    geo: "none",
    limit: 10,
    ttl: 24 * 30,
    columns: "domain, created, expires, registrar, keywords, etv, ref_domains, backlinks",
    body: ({ args }) => {
      const domains: string[] = args[0];
      const filters: any[] = [];
      domains.forEach((d, i) => {
        if (i) filters.push("or");
        filters.push(["domain", "=", d]);
      });
      return { filters: domains.length === 1 ? filters[0] : filters };
    },
    map: fromItems({
      domain: "domain",
      created: (i: any) => date(i.created_datetime),
      expires: (i: any) => date(i.expiration_datetime),
      registrar: "registrar",
      keywords: "metrics.organic.count",
      etv: "metrics.organic.etv",
      ref_domains: "backlinks_info.referring_domains",
      backlinks: "backlinks_info.backlinks",
    }),
  });
}
