import { Command } from "commander";
import { Ctx, Mapped, register } from "../registry";
import { date, dom, domainOf, fromItems, truncate } from "../map";
import { items, Row } from "../trim";

const TTL = 12;

// Shared options for Google/Bing organic SERPs.
const serpOpts: [string, string, string?][] = [
  ["--depth <n>", "Results to fetch from the SERP (billed per 10)", "10"],
  ["--device <device>", "desktop or mobile", "desktop"],
];

function aioRows(it: any, ctx: Ctx, type = "aio_ref"): Row[] {
  const refs: any[] = [...(it.references || [])];
  for (const sub of it.items || []) for (const r of sub.references || []) refs.push(r);
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const r of refs) {
    if (!r?.url || seen.has(r.url)) continue;
    seen.add(r.url);
    rows.push({ type, domain: r.domain || domainOf(r.url), title: truncate(r.title || r.source, ctx.trim, 90), url: r.url });
  }
  return rows;
}

function aioText(it: any): string {
  if (it.markdown) return it.markdown;
  return (it.items || []).map((s: any) => [s.title, s.text].filter(Boolean).join(": ")).join(" ");
}

// One table for the whole SERP: organic results plus AI Overview, PAA, featured snippet and other features.
export function organicRows(resp: any, ctx: Ctx): Mapped {
  const types: string[] | null = ctx.opts.types ? String(ctx.opts.types).split(",").map((t) => t.trim()) : null;
  const all = items(resp);
  const rows: Row[] = [];
  const aio = all.find((i) => i.type === "ai_overview");
  rows.push({
    pos: "",
    type: "ai_overview",
    domain: "",
    title: aio ? `present (${aioRows(aio, ctx).length} cited)` : "absent",
    url: "",
    snippet: aio ? truncate(aioText(aio), ctx.trim, 300) : "",
  });
  if (aio) rows.push(...aioRows(aio, ctx));
  for (const it of all) {
    const pos = it.rank_group ?? "";
    switch (it.type) {
      case "ai_overview":
        break;
      case "organic":
      case "featured_snippet":
        rows.push({
          pos: it.type === "organic" ? pos : "",
          type: it.type,
          domain: it.domain || domainOf(it.url),
          title: truncate(it.featured_title || it.title, ctx.trim, 100),
          url: it.url,
          snippet: truncate(it.description, ctx.trim),
        });
        break;
      case "people_also_ask":
        for (const q of it.items || []) {
          const ans = (q.expanded_element || [])[0] || {};
          rows.push({
            type: "paa",
            domain: ans.domain || domainOf(ans.url),
            title: q.title,
            url: ans.url || "",
            snippet: truncate(ans.description || ans.text || (ans.type === "people_also_ask_ai_overview_expanded_element" ? aioText(ans) : ""), ctx.trim),
          });
        }
        break;
      case "related_searches":
      case "people_also_search":
        rows.push({ type: it.type, title: truncate((it.items || []).join("; "), ctx.trim, 300) });
        break;
      default: {
        const subs: any[] = Array.isArray(it.items) ? it.items : [];
        rows.push({
          pos: "",
          type: it.type,
          domain: it.domain || domainOf(it.url),
          title: truncate(it.title || subs.map((s) => s.title || s.source || s.domain).filter(Boolean).slice(0, 5).join("; "), ctx.trim, 140),
          url: it.url || "",
          snippet: truncate(it.description || it.text || "", ctx.trim, 120),
        });
      }
    }
  }
  const filtered = types ? rows.filter((r) => types.some((t) => r.type === t || r.type.startsWith(t))) : rows;
  return { rows: filtered };
}

// AI Mode and LLM-style answers: first row is the answer, then the cited sources.
export function answerRows(text: string, refs: any[], ctx: Ctx, extra: Row = {}): Row[] {
  const rows: Row[] = [{ type: "answer", ...extra, title: "", url: "", text: truncate(text, ctx.trim, 1200) }];
  const seen = new Set<string>();
  for (const r of refs) {
    const url = r?.url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    rows.push({ type: "source", title: truncate(r.title || r.source || domainOf(url), ctx.trim, 90), url, text: "" });
  }
  return rows;
}

export function registerSerp(program: Command): void {
  const g = program.command("serp").description("Live search results: Google organic (AI Overview, PAA), AI Mode, autocomplete, news, images, maps, YouTube, Bing");

  register(g, {
    name: "organic",
    aliases: ["google"],
    desc: "Google organic SERP with AI Overview (present + cited URLs), People Also Ask, featured snippet and other features",
    path: "serp/google/organic/live/advanced",
    args: ["<keyword>"],
    options: [...serpOpts, ["--types <list>", "Only these row types, e.g. organic,paa,aio,featured_snippet"]],
    limit: 50,
    apiLimit: false,
    ttl: TTL,
    columns: "pos, type (ai_overview|aio_ref|organic|featured_snippet|paa|related_searches|<feature>), domain, title, url, snippet",
    body: ({ args, opts }) => ({
      keyword: args[0],
      depth: parseInt(opts.depth),
      device: opts.device,
      load_async_ai_overview: true,
      people_also_ask_click_depth: 1,
    }),
    map: organicRows,
  });

  register(g, {
    name: "ai-mode",
    desc: "Google AI Mode answer with cited sources",
    path: "serp/google/ai_mode/live/advanced",
    args: ["<keyword>"],
    options: [["--device <device>", "desktop or mobile", "desktop"]],
    limit: 30,
    apiLimit: false,
    ttl: TTL,
    columns: "type (answer|source), title, url, text",
    body: ({ args, opts }) => ({ keyword: args[0], device: opts.device }),
    map: (resp, ctx) => {
      const all = items(resp);
      const text = all.map((i) => i.markdown || aioText(i)).filter(Boolean).join(" ");
      const refs = all.flatMap((i) => [...(i.references || []), ...(i.items || []).flatMap((s: any) => s.references || [])]);
      return { rows: answerRows(text, refs, ctx) };
    },
  });

  register(g, {
    name: "autocomplete",
    desc: "Google autocomplete suggestions",
    path: "serp/google/autocomplete/live/advanced",
    args: ["<keyword>"],
    options: [["--cursor <n>", "Cursor position in the keyword (default: end)"], ["--client <client>", "Suggest client, e.g. gws-wiz, chrome, youtube"]],
    limit: 30,
    apiLimit: false,
    ttl: TTL,
    columns: "pos, suggestion",
    body: ({ args, opts }) => ({
      keyword: args[0],
      ...(opts.cursor ? { cursor_pointer: parseInt(opts.cursor) } : {}),
      ...(opts.client ? { client: opts.client } : {}),
    }),
    map: fromItems({ pos: "rank_group", suggestion: "suggestion|title" }, (i) => i.type === "autocomplete"),
  });

  register(g, {
    name: "news",
    desc: "Google News results",
    path: "serp/google/news/live/advanced",
    args: ["<keyword>"],
    options: [["--depth <n>", "Results to fetch", "10"], ["--sort-by <by>", "relevance or date"]],
    limit: 20,
    apiLimit: false,
    ttl: TTL,
    columns: "pos, date, source, domain, title, url, snippet",
    body: ({ args, opts }) => ({ keyword: args[0], depth: parseInt(opts.depth), ...(opts.sortBy ? { sort_by: opts.sortBy } : {}) }),
    map: (resp, ctx) => {
      const rows: Row[] = [];
      for (const it of items(resp)) {
        const list = it.type === "top_stories" ? it.items || [] : [it];
        for (const n of list) {
          rows.push({
            pos: n.rank_group ?? it.rank_group ?? "",
            date: date(n.timestamp) || n.time_published || "",
            source: n.source || "",
            domain: n.domain || domainOf(n.url),
            title: truncate(n.title, ctx.trim, 120),
            url: n.url,
            snippet: truncate(n.snippet || n.description, ctx.trim),
          });
        }
      }
      return { rows };
    },
  });

  register(g, {
    name: "images",
    desc: "Google Images results",
    path: "serp/google/images/live/advanced",
    args: ["<keyword>"],
    options: [["--depth <n>", "Results to fetch", "20"]],
    limit: 20,
    apiLimit: false,
    ttl: TTL,
    columns: "pos, title, domain, page_url",
    body: ({ args, opts }) => ({ keyword: args[0], depth: parseInt(opts.depth) }),
    map: fromItems(
      { pos: "rank_group", title: "title|alt", domain: dom("source_url|url"), page_url: "source_url|url" },
      (i) => i.type === "images_search"
    ),
  });

  const mapsCols = {
    pos: "rank_group",
    title: "title",
    category: "category",
    rating: "rating.value",
    reviews: "rating.votes_count",
    price: "price_level",
    address: "address",
    phone: "phone",
    domain: "domain",
    claimed: "is_claimed",
  };

  register(g, {
    name: "maps",
    desc: "Google Maps results (local businesses)",
    path: "serp/google/maps/live/advanced",
    args: ["<keyword>"],
    options: [["--depth <n>", "Results to fetch", "20"]],
    limit: 20,
    apiLimit: false,
    ttl: TTL,
    columns: Object.keys(mapsCols).join(", "),
    body: ({ args, opts }) => ({ keyword: args[0], depth: parseInt(opts.depth) }),
    map: fromItems(mapsCols, (i) => i.type === "maps_search"),
  });

  register(g, {
    name: "local",
    aliases: ["local-finder"],
    desc: "Google Local Finder (local pack expanded)",
    path: "serp/google/local_finder/live/advanced",
    args: ["<keyword>"],
    options: [["--depth <n>", "Results to fetch", "20"]],
    limit: 20,
    apiLimit: false,
    ttl: TTL,
    columns: "pos, title, category, rating, reviews, address, phone, domain",
    body: ({ args, opts }) => ({ keyword: args[0], depth: parseInt(opts.depth) }),
    map: fromItems({
      pos: "rank_group",
      title: "title",
      category: "category",
      rating: "rating.value",
      reviews: "rating.votes_count",
      address: "address",
      phone: "phone",
      domain: "domain",
    }),
  });

  register(g, {
    name: "youtube",
    desc: "YouTube search results",
    path: "serp/youtube/organic/live/advanced",
    args: ["<keyword>"],
    options: [["--depth <n>", "Results to fetch", "20"]],
    limit: 20,
    apiLimit: false,
    ttl: TTL,
    columns: "pos, title, channel, views, published, duration, url",
    body: ({ args, opts }) => ({ keyword: args[0], depth: parseInt(opts.depth), device: "desktop", os: "windows" }),
    map: fromItems(
      {
        pos: "rank_group",
        title: "title",
        channel: "channel_name",
        views: "views_count",
        published: (i) => date(i.timestamp) || i.publication_date,
        duration: "duration_time",
        url: "url",
      },
      (i) => i.type === "youtube_video"
    ),
  });

  register(g, {
    name: "bing",
    desc: "Bing organic SERP",
    path: "serp/bing/organic/live/advanced",
    args: ["<keyword>"],
    options: serpOpts,
    limit: 50,
    apiLimit: false,
    ttl: TTL,
    columns: "pos, type, domain, title, url, snippet",
    body: ({ args, opts }) => ({ keyword: args[0], depth: parseInt(opts.depth), device: opts.device }),
    map: organicRows,
  });
}

