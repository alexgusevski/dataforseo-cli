import { Command } from "commander";
import { call, CliError } from "../client";
import { callOptions, callOpts, Ctx, emit, fail, outputOptions, register } from "../registry";
import { pick, truncate } from "../map";
import { items, results, Row } from "../trim";

const TTL = 24;

// Check flags that are good news when true; every other true flag is an issue.
const GOOD_CHECKS = /^(is_https|is_http|has_html_doctype|canonical|seo_friendly_url.*|is_www|from_sitemap|enable_.*|has_meta_title|has_meta_description)$/;

export function issues(checks: Record<string, any> | undefined): string {
  if (!checks) return "";
  return Object.entries(checks)
    .filter(([k, v]) => v === true && !GOOD_CHECKS.test(k))
    .map(([k]) => k)
    .join(",");
}

const pageCols = {
  url: "url",
  status: "status_code",
  score: "onpage_score",
  title: "meta.title",
  description: "meta.description",
  h1: (p: any) => (p.meta?.htags?.h1 || [])[0],
  words: "meta.content.plain_text_word_count",
  int_links: "meta.internal_links_count",
  ext_links: "meta.external_links_count",
  load_ms: "page_timing.duration_time",
  issues: (p: any) => issues(p.checks),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function crawlReport(id: string, opts: any, limit: number): Promise<void> {
  const deadline = Date.now() + parseInt(opts.timeout ?? "600") * 1000;
  let summary: any;
  for (;;) {
    const { response } = await call(`on_page/summary/${id}`, undefined, { ttlHours: 0 });
    summary = results(response)[0];
    if (summary?.crawl_progress === "finished") break;
    if (Date.now() > deadline) {
      throw new CliError(`Crawl still running (${summary?.crawl_status?.pages_crawled ?? 0} pages so far); fetch later: dataforseo-cli onpage result ${id}`);
    }
    await sleep(5000);
  }
  const { response } = await call("on_page/pages", [{ id, limit: limit || 100, order_by: ["meta.content.plain_text_word_count,desc"] }], { ttlHours: 0 });
  const ctx: Ctx = { args: [], opts, limit, trim: { fullText: !!opts.fullText } };
  const m = summary.page_metrics || {};
  const info = summary.domain_info || {};
  const overview: Row = {
    task_id: id,
    domain: info.name,
    pages_crawled: summary.crawl_status?.pages_crawled,
    onpage_score: m.onpage_score,
    cms: info.cms,
    server: info.server,
    broken_links: m.broken_links,
    broken_resources: m.broken_resources,
    duplicate_titles: m.duplicate_title,
    duplicate_descriptions: m.duplicate_description,
    duplicate_content: m.duplicate_content,
    non_indexable: m.non_indexable,
  };
  const checkRows = Object.entries(m.checks || {})
    .filter(([k, v]) => typeof v === "number" && v > 0 && !GOOD_CHECKS.test(k))
    .sort((a: any, b: any) => b[1] - a[1])
    .map(([check, pages]) => ({ check, pages }));
  emit(
    {
      rows: [],
      sections: [
        { name: "summary", rows: [overview] },
        { name: "issues", rows: checkRows },
        { name: "pages", rows: items(response).map((p) => pick(p, pageCols, ctx)) },
      ],
    },
    opts,
    limit
  );
}

export function registerOnPage(program: Command): void {
  const g = program.command("onpage").description("OnPage API: instant page audit, content parsing, Lighthouse, site crawl");

  register(g, {
    name: "instant",
    desc: "Instant SEO audit of one page: status, title, description, H1, word count, links, load time, issues",
    path: "on_page/instant_pages",
    args: ["<url>"],
    geo: "none",
    options: [["--js", "Render JavaScript (costs more)"]],
    limit: 0,
    apiLimit: false,
    ttl: TTL,
    columns: Object.keys(pageCols).join(", "),
    body: ({ args, opts }) => ({ url: args[0], enable_javascript: !!opts.js }),
    map: (resp, ctx) => ({ rows: items(resp).map((p) => pick(p, pageCols, ctx)) }),
  });

  register(g, {
    name: "parse",
    aliases: ["content"],
    desc: "Parse a page's main content into headings and text (or --markdown for the page as markdown)",
    path: "on_page/content_parsing/live",
    args: ["<url>"],
    geo: "none",
    options: [["--markdown", "Return the page as markdown (one row)"]],
    limit: 40,
    apiLimit: false,
    ttl: TTL,
    columns: "level, heading, text (or: markdown)",
    body: ({ args, opts }) => ({ url: args[0], ...(opts.markdown ? { markdown_view: true } : {}) }),
    map: (resp, ctx) => {
      const rows: Row[] = [];
      for (const it of items(resp)) {
        if (ctx.opts.markdown && it.page_as_markdown) {
          rows.push({ markdown: truncate(it.page_as_markdown, ctx.trim, 4000) });
          continue;
        }
        const pc = it.page_content || {};
        const header = (pc.header?.primary_content || []).map((c: any) => c.text).join(" ");
        if (header) rows.push({ level: 0, heading: "(header)", text: truncate(header, ctx.trim, 200) });
        for (const t of [...(pc.main_topic || []), ...(pc.secondary_topic || [])]) {
          const text = (t.primary_content || []).map((c: any) => c.text).join(" ");
          rows.push({ level: t.level ?? "", heading: truncate(t.h_title, ctx.trim, 120), text: truncate(text, ctx.trim, 300) });
        }
      }
      return { rows };
    },
  });

  register(g, {
    name: "lighthouse",
    desc: "Lighthouse scores and Core Web Vitals for a URL (--audits lists failing audits)",
    path: "on_page/lighthouse/live/json",
    args: ["<url>"],
    geo: "none",
    options: [["--mobile", "Mobile emulation"], ["--audits", "List failing audits instead of the score row"]],
    limit: 30,
    apiLimit: false,
    ttl: TTL,
    columns: "url, performance, accessibility, best_practices, seo, lcp, cls, tbt, fcp, speed_index (or with --audits: audit, score, title, value)",
    body: ({ args, opts }) => ({ url: args[0], for_mobile: !!opts.mobile }),
    map: (resp, ctx) => {
      const rows: Row[] = [];
      for (const r of results(resp)) {
        const cat = r.categories || {};
        const au = r.audits || {};
        const score = (k: string) => (cat[k]?.score !== undefined && cat[k]?.score !== null ? Math.round(cat[k].score * 100) : "");
        if (ctx.opts.audits) {
          for (const [id, a] of Object.entries<any>(au)) {
            if (a.score === null || a.score === undefined || a.score >= 0.9 || a.scoreDisplayMode === "informative") continue;
            rows.push({ audit: id, score: Math.round(a.score * 100), title: a.title, value: a.displayValue || "" });
          }
          rows.sort((a, b) => a.score - b.score);
        } else {
          rows.push({
            url: r.finalUrl || r.requestedUrl || ctx.args[0],
            performance: score("performance"),
            accessibility: score("accessibility"),
            best_practices: score("best-practices"),
            seo: score("seo"),
            lcp: au["largest-contentful-paint"]?.displayValue ?? "",
            cls: au["cumulative-layout-shift"]?.displayValue ?? "",
            tbt: au["total-blocking-time"]?.displayValue ?? "",
            fcp: au["first-contentful-paint"]?.displayValue ?? "",
            speed_index: au["speed-index"]?.displayValue ?? "",
          });
        }
      }
      return { rows };
    },
  });

  const crawl = g
    .command("crawl")
    .description("Crawl a site (queue task), wait for it, then print summary, issue counts and pages")
    .argument("<target>", "Domain to crawl, e.g. example.com")
    .option("--max-pages <n>", "Max pages to crawl (billed per page)", "20")
    .option("--js", "Render JavaScript (costs more)")
    .option("-n, --limit <n>", "Max page rows", "30");
  callOptions(outputOptions(crawl));
  crawl.action(async (target: string, opts: any) => {
    try {
      const body = [{ target, max_crawl_pages: parseInt(opts.maxPages), enable_javascript: !!opts.js, load_resources: false }];
      // Post only; crawlReport polls the summary endpoint instead of task_get.
      const { response } = await call("on_page/task_post", body, { ...callOpts(opts, 0), queue: false, ttlHours: 0 });
      const id = response.tasks?.[0]?.id;
      if (!id) throw new CliError("Crawl task was not created");
      process.stderr.write(`crawl task ${id} started; polling summary (resume with: dataforseo-cli onpage result ${id})\n`);
      await crawlReport(id, opts, parseInt(opts.limit));
    } catch (e) {
      fail(e);
    }
  });

  const result = g
    .command("result")
    .description("Summary, issues and pages of an existing crawl task")
    .argument("<task-id>")
    .option("--timeout <sec>", "Wait this long for the crawl to finish", "600")
    .option("-n, --limit <n>", "Max page rows", "30");
  outputOptions(result);
  result.action(async (id: string, opts: any) => {
    try {
      await crawlReport(id, opts, parseInt(opts.limit));
    } catch (e) {
      fail(e);
    }
  });
}
