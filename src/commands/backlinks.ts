import { Command } from "commander";
import { Ctx, register, TypedCommand } from "../registry";
import { date, fromItems, fromResults, get } from "../map";
import { items } from "../trim";

const TTL = 24 * 7;
const B = "backlinks";

function bl(def: Omit<TypedCommand, "ttl" | "geo"> & { ttl?: number }): TypedCommand {
  return { ttl: TTL, geo: "none", limit: 20, ...def };
}

const orderOpt = (field: string): [string, string, string?] => ["--order <field,dir>", `Sort, e.g. "${field},desc"`, `${field},desc`];
const order = (o: any) => (o.order ? { order_by: [o.order] } : {});

export function registerBacklinks(program: Command): void {
  const g = program
    .command("backlinks")
    .description("Backlinks API (needs the Backlinks subscription): summary, backlinks, referring domains, anchors, bulk ranks, competitors, history");

  register(g, bl({
    name: "summary",
    desc: "Backlink profile summary of a domain, subdomain or URL",
    path: `${B}/summary/live`,
    args: ["<target>"],
    limit: 0,
    apiLimit: false,
    columns: "target, rank, backlinks, ref_domains, ref_main_domains, ref_ips, nofollow_domains, broken, spam_score, first_seen",
    body: ({ args }) => ({ target: args[0], include_subdomains: true }),
    map: fromResults({
      target: "target",
      rank: "rank",
      backlinks: "backlinks",
      ref_domains: "referring_domains",
      ref_main_domains: "referring_main_domains",
      ref_ips: "referring_ips",
      nofollow_domains: "referring_domains_nofollow",
      broken: "broken_backlinks",
      spam_score: "backlinks_spam_score",
      first_seen: (r: any) => date(r.first_seen),
    }),
  }));

  register(g, bl({
    name: "list",
    aliases: ["backlinks"],
    desc: "Backlinks to a target (default: one per referring domain, strongest first)",
    path: `${B}/backlinks/live`,
    args: ["<target>"],
    options: [["--mode <mode>", "as_is, one_per_domain or one_per_anchor", "one_per_domain"], orderOpt("rank")],
    columns: "from_domain, from_url, to_url, anchor, dofollow, domain_rank, page_rank, first_seen, lost",
    body: ({ args, opts }) => ({ target: args[0], mode: opts.mode, ...order(opts) }),
    map: fromItems({
      from_domain: "domain_from",
      from_url: "url_from",
      to_url: "url_to",
      anchor: "anchor",
      dofollow: "dofollow",
      domain_rank: "domain_from_rank",
      page_rank: "rank",
      first_seen: (i: any) => date(i.first_seen),
      lost: "is_lost",
    }),
  }));

  register(g, bl({
    name: "domains",
    aliases: ["referring-domains"],
    desc: "Referring domains of a target",
    path: `${B}/referring_domains/live`,
    args: ["<target>"],
    options: [orderOpt("rank")],
    columns: "domain, rank, backlinks, spam_score, first_seen",
    body: ({ args, opts }) => ({ target: args[0], ...order(opts) }),
    map: fromItems({
      domain: "domain",
      rank: "rank",
      backlinks: "backlinks",
      spam_score: "backlinks_spam_score",
      first_seen: (i: any) => date(i.first_seen),
    }),
  }));

  register(g, bl({
    name: "anchors",
    desc: "Anchor texts pointing to a target",
    path: `${B}/anchors/live`,
    args: ["<target>"],
    options: [orderOpt("backlinks")],
    columns: "anchor, backlinks, ref_domains, rank, first_seen",
    body: ({ args, opts }) => ({ target: args[0], ...order(opts) }),
    map: fromItems({
      anchor: "anchor",
      backlinks: "backlinks",
      ref_domains: "referring_domains",
      rank: "rank",
      first_seen: (i: any) => date(i.first_seen),
    }),
  }));

  register(g, bl({
    name: "bulk-ranks",
    desc: "Rank (0-1000 domain strength) for up to 1000 targets",
    path: `${B}/bulk_ranks/live`,
    args: ["<targets...>"],
    maxBatch: 1000,
    limit: 100,
    apiLimit: false,
    columns: "target, rank",
    body: ({ args }) => ({ targets: args[0] }),
    map: fromItems({ target: "target", rank: "rank" }),
  }));

  register(g, bl({
    name: "bulk-backlinks",
    desc: "Backlink counts for up to 1000 targets",
    path: `${B}/bulk_backlinks/live`,
    args: ["<targets...>"],
    maxBatch: 1000,
    limit: 100,
    apiLimit: false,
    columns: "target, backlinks",
    body: ({ args }) => ({ targets: args[0] }),
    map: fromItems({ target: "target", backlinks: "backlinks" }),
  }));

  register(g, bl({
    name: "competitors",
    desc: "Domains sharing the most referring domains with a target",
    path: `${B}/competitors/live`,
    args: ["<target>"],
    columns: "domain, rank, shared",
    body: ({ args }) => ({ target: args[0], exclude_large_domains: true }),
    map: fromItems({ domain: "target", rank: "rank", shared: "intersections" }),
  }));

  register(g, bl({
    name: "intersection",
    desc: "Referring domains that link to all given targets (link gap: add --exclude <domain>)",
    path: `${B}/domain_intersection/live`,
    args: ["<targets...>"],
    options: [["--exclude <domain>", "Only domains that do NOT link to this target"]],
    columns: "domain, rank, <target>_backlinks...",
    body: ({ args, opts }) => {
      const targets: Record<string, string> = {};
      (args[0] as string[]).forEach((t, i) => (targets[String(i + 1)] = t));
      return { targets, ...(opts.exclude ? { exclude_targets: [opts.exclude] } : {}) };
    },
    map: (resp: any, ctx: Ctx) => ({
      rows: items(resp).map((i) => {
        const parts: any = i.domain_intersection || {};
        const first: any = Object.values(parts)[0] || {};
        const row: Record<string, any> = { domain: first.target || first.domain || get(i, "summary.target") || "", rank: first.rank ?? "" };
        (ctx.args[0] as string[]).forEach((t, n) => (row[`${t}_backlinks`] = parts[String(n + 1)]?.backlinks ?? ""));
        return row;
      }),
    }),
  }));

  register(g, bl({
    name: "history",
    desc: "Monthly backlink history of a domain (rank, backlinks, referring domains, new/lost)",
    path: `${B}/history/live`,
    args: ["<target>"],
    options: [["--from <date>", "Start date YYYY-MM-DD (default: one year ago)"]],
    limit: 24,
    apiLimit: false,
    columns: "date, rank, backlinks, ref_domains, new_backlinks, lost_backlinks, new_domains, lost_domains",
    body: ({ args, opts }) => ({
      target: args[0],
      date_from: opts.from || new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10),
    }),
    map: fromItems({
      date: (i: any) => date(i.date),
      rank: "rank",
      backlinks: "backlinks",
      ref_domains: "referring_domains",
      new_backlinks: "new_backlinks",
      lost_backlinks: "lost_backlinks",
      new_domains: "new_referring_domains",
      lost_domains: "lost_referring_domains",
    }),
  }));
}
