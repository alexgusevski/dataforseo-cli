import { Command } from "commander";
import { Ctx, Mapped, register } from "../registry";
import { fromItems, list, trend, truncate } from "../map";
import { domainOf, results, Row, stripMarkdown } from "../trim";
import { answerRows } from "./serp";

const AI = "ai_optimization";

// A target that looks like a domain becomes a domain entity, anything else a keyword entity.
export function mentionTarget(t: string): Record<string, any> {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(t.trim()) ? { domain: t.trim() } : { keyword: t.trim() };
}

const platformOpt: [string, string, string?] = ["--platform <p>", "chat_gpt or google (AI Overviews); default both"];
const platform = (o: any) => (o.platform ? { platform: o.platform } : {});

// LLM mention aggregates are lists of { key, mentions, ai_search_volume }.
const keyCount = (list: any[], key: string) => (list || []).find((x: any) => x.key === key)?.mentions ?? "";
const topKeys = (list: any[], n = 5) => (list || []).slice(0, n).map((x: any) => domainOf(String(x.key))).join(",");

const DIMENSIONS = ["platform", "sources_domain", "search_results_domain", "brand_entities_title", "brand_entities_category"];

const MODELS: Record<string, string> = {
  chatgpt: "gpt-5.4-mini",
  claude: "claude-haiku-5-5",
  gemini: "gemini-3.5-flash",
  perplexity: "sonar",
};

export function registerAi(program: Command): void {
  const g = program
    .command("ai")
    .description("AI Optimization API: brand/domain mentions in ChatGPT and AI Overviews, AI search volume, LLM answers, ChatGPT/Gemini scrapers");

  register(g, {
    name: "mentions",
    desc: "LLM answers that mention a domain or keyword/brand, with AI search volume and cited sources ($0.10+ per call)",
    path: `${AI}/llm_mentions/search_mentions/live`,
    args: ["<target>"],
    options: [platformOpt],
    limit: 10,
    ttl: 24 * 7,
    columns: "platform, question, ai_volume, answer, sources, brands",
    body: ({ args, opts }) => ({ target: [mentionTarget(args[0])], ...platform(opts) }),
    map: fromItems({
      platform: "platform",
      question: (i: any, ctx: Ctx) => truncate(i.question, ctx.trim, 140),
      ai_volume: "ai_search_volume",
      answer: (i: any, ctx: Ctx) => truncate(stripMarkdown(i.answer), ctx.trim, 240),
      sources: (i: any) => list((i.sources || []).map((s: any) => domainOf(s.domain || s.url)), 6, ","),
      brands: (i: any) => list((i.brand_entities || []).map((b: any) => b.title), 6, ","),
    }),
  });

  register(g, {
    name: "mention-metrics",
    desc: "Aggregated LLM mention metrics for a domain or keyword (mentions, AI search volume, by platform)",
    path: `${AI}/llm_mentions/target_metrics/live`,
    args: ["<target>"],
    limit: 0,
    apiLimit: false,
    ttl: 24 * 7,
    options: [platformOpt, ["--top <n>", "Entries per dimension", "5"]],
    columns: "dimension (platform|sources_domain|search_results_domain|brand_entities_title|brand_entities_category), key, mentions, ai_volume",
    body: ({ args, opts }) => ({ target: [mentionTarget(args[0])], ...platform(opts) }),
    map: (resp: any, ctx: Ctx): Mapped => {
      const rows: Row[] = [];
      for (const r of results(resp)) {
        const agg = r.aggregated_metrics || {};
        for (const dim of DIMENSIONS) {
          for (const x of (agg[dim] || []).slice(0, parseInt(ctx.opts.top ?? "5"))) {
            rows.push({ dimension: dim, key: /domain/.test(dim) ? domainOf(String(x.key)) : x.key, mentions: x.mentions, ai_volume: x.ai_search_volume });
          }
        }
      }
      return { rows };
    },
  });

  for (const [name, path, what, field] of [
    ["top-domains", "top_mentioned_domains", "domains", "domain"],
    ["top-pages", "top_mentioned_pages", "pages", "page"],
    ["top-brands", "top_mentioned_brands", "brands", "brand"],
  ] as const) {
    register(g, {
      name,
      desc: `Top ${what} mentioned in LLM answers about a domain or keyword ($0.10+ per call)`,
      path: `${AI}/llm_mentions/${path}/live`,
      args: ["<target>"],
      options: [platformOpt],
      limit: 20,
      ttl: 24 * 7,
      columns: `${field}, mentions, ai_volume, google, chatgpt, top_sources`,
      body: ({ args, opts }) => ({ target: [mentionTarget(args[0])], ...platform(opts) }),
      map: fromItems({
        [field]: (i: any) => (field === "domain" ? domainOf(i.domain) : i[field]),
        mentions: "total.mentions",
        ai_volume: "total.ai_search_volume",
        google: (i: any) => keyCount(i.platform, "google"),
        chatgpt: (i: any) => keyCount(i.platform, "chat_gpt"),
        top_sources: (i: any) => topKeys(i.sources_domain),
      }),
    });
  }

  register(g, {
    name: "volume",
    desc: "AI search volume (how often keywords are asked in AI assistants) with 12-month trend",
    path: `${AI}/ai_keyword_data/keywords_search_volume/live`,
    args: ["<keywords...>"],
    maxBatch: 1000,
    perKeyword: true,
    limit: 100,
    apiLimit: false,
    ttl: 24 * 30,
    columns: "keyword, ai_volume, trend",
    body: ({ args }) => ({ keywords: args[0] }),
    map: fromItems({
      keyword: "keyword",
      ai_volume: "ai_search_volume",
      trend: (i: any) => trend(i.ai_monthly_searches, 12, "ai_search_volume"),
    }),
  });

  register(g, {
    name: "ask",
    aliases: ["llm"],
    desc: "Ask an LLM through its API (chatgpt, claude, gemini, perplexity) and get the answer plus cited sources",
    path: ({ opts }) => `${AI}/${opts.llm === "chatgpt" ? "chat_gpt" : opts.llm}/llm_responses/live`,
    args: ["<prompt>"],
    geo: "none",
    options: [
      ["--llm <name>", "chatgpt, claude, gemini or perplexity", "chatgpt"],
      ["--model <name>", "Model name (see: dataforseo-cli api ai_optimization/<llm>/llm_responses/models)"],
      ["--web-search", "Let the model search the web (where supported)"],
      ["--max-tokens <n>", "Max output tokens (reasoning models need 1024+; default: API default)"],
    ],
    limit: 30,
    apiLimit: false,
    ttl: 24,
    columns: "type (answer|source), model, title, url, text",
    body: ({ args, opts }) => ({
      user_prompt: args[0],
      model_name: opts.model || MODELS[opts.llm] || MODELS.chatgpt,
      ...(opts.maxTokens ? { max_output_tokens: parseInt(opts.maxTokens) } : {}),
      ...(opts.webSearch ? { web_search: true } : {}),
    }),
    map: (resp: any, ctx: Ctx): Mapped => {
      const rows: Row[] = [];
      for (const r of results(resp)) {
        const sections = (r.items || []).flatMap((i: any) => i.sections || [i]);
        const text = sections.map((s: any) => s.text || "").join("\n");
        const refs = sections.flatMap((s: any) => s.annotations || []);
        rows.push(...answerRows(text, refs, ctx, { model: r.model_name }));
      }
      return { rows };
    },
  });

  for (const [name, llm] of [["chatgpt-scrape", "chat_gpt"], ["gemini-scrape", "gemini"]] as const) {
    register(g, {
      name,
      desc: `What ${llm === "chat_gpt" ? "ChatGPT" : "Gemini"}'s consumer web app answers for a prompt (scraped), with sources`,
      path: `${AI}/${llm}/llm_scraper/live/advanced`,
      args: ["<prompt>"],
      limit: 30,
      apiLimit: false,
      ttl: 24,
      columns: "type (answer|source), title, url, text",
      body: ({ args }) => ({ keyword: args[0] }),
      map: (resp: any, ctx: Ctx): Mapped => {
        const rows: Row[] = [];
        for (const r of results(resp)) {
          const its = r.items || [];
          const text = r.markdown || its.map((i: any) => i.markdown || i.text || "").filter(Boolean).join("\n");
          const refs = [...(r.sources || []), ...its.flatMap((i: any) => [...(i.sources || []), ...(i.references || [])])];
          rows.push(...answerRows(text, refs, ctx));
        }
        return { rows };
      },
    });
  }
}

