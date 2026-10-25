import { Command } from "commander";
import { call, CliError } from "../client";
import { getSetting, setSetting, SETTINGS } from "../config";
import { emit, fail, outputOptions } from "../registry";
import { flatten as flattenPrices, savePrices } from "../prices";
import { readSession, resetSession } from "../session";
import { results } from "../trim";

const sub = (d: string | undefined) => {
  if (!d) return "none";
  const t = Date.parse(d.replace(" +00:00", "Z").replace(" ", "T"));
  return isNaN(t) ? d : t > Date.now() ? `active until ${d.slice(0, 10)}` : `expired ${d.slice(0, 10)}`;
};

async function userData(): Promise<any> {
  const { response } = await call("appendix/user_data", undefined, { ttlHours: 0 });
  const r = results(response)[0];
  if (!r) throw new CliError("No account data returned");
  if (r.price) savePrices(r.price);
  return r;
}

// Labels for the API groups in the account's day-limit tree.
const API_GROUPS = ["serp", "keywords_data", "dataforseo_labs", "backlinks", "on_page", "content_analysis", "domain_analytics", "merchant", "app_data", "business_data", "ai_optimization"];

export function registerAccount(program: Command): void {
  outputOptions(
    program
      .command("balance")
      .alias("account")
      .description("Account balance, total deposited, subscriptions (Backlinks, LLM Mentions), daily limit (free call)")
  ).action(async (opts: any) => {
    try {
      const r = await userData();
      const day = r.money?.limits?.day || {};
      emit(
        {
          rows: [
            {
              balance: r.money?.balance,
              deposited: r.money?.total,
              backlinks: sub(r.backlinks_subscription_expiry_date),
              llm_mentions: sub(r.llm_mentions_subscription_expiry_date),
              daily_limit: day.total ?? "",
              apis_priced: API_GROUPS.filter((g) => r.price?.[g]).length + "/" + API_GROUPS.length,
            },
          ],
        },
        opts,
        0
      );
    } catch (e) {
      fail(e);
    }
  });

  outputOptions(
    program
      .command("prices")
      .description("Endpoint price list for this account (USD per request / per result), optionally filtered")
      .argument("[filter]", "Substring of the endpoint path, e.g. labs or trustpilot")
      .option("-n, --limit <n>", "Max rows", "60")
  ).action(async (filter: string | undefined, opts: any) => {
    try {
      const r = await userData();
      const rows = flattenPrices(r.price).filter((p) => !filter || p.endpoint.includes(filter) || p.endpoint.includes(filter.replace("labs", "dataforseo_labs")));
      emit({ rows: rows.filter((p) => p.per_request || p.per_result) }, opts, parseInt(opts.limit));
    } catch (e) {
      fail(e);
    }
  });

  program
    .command("session")
    .description("Spend so far this session (a session ends after 6 idle hours)")
    .option("--reset", "Start a new session total")
    .action((opts: any) => {
      if (opts.reset) resetSession();
      const s = readSession();
      const cap = getSetting("session_cap");
      console.log(
        `session=$${s.total.toFixed(4)} calls=${s.calls} since=${new Date(s.start).toISOString().slice(0, 16)}` +
          (cap !== undefined ? ` cap=$${cap}` : "")
      );
    });

  program
    .command("config")
    .description(`Show or change settings: ${Object.keys(SETTINGS).join(", ")} (credentials are never shown)`)
    .argument("[key]")
    .argument("[value]", "Number, or 'unset'")
    .action((key: string | undefined, value: string | undefined) => {
      try {
        if (key && value !== undefined) {
          const num = value === "unset" ? undefined : parseFloat(value);
          if (num !== undefined && isNaN(num)) throw new CliError(`${key} needs a number (USD) or 'unset'`);
          setSetting(key, num);
        }
        for (const [k, desc] of Object.entries(SETTINGS)) {
          if (key && k !== key) continue;
          console.log(`${k}=${getSetting(k) ?? "(default)"}\t${desc}`);
        }
      } catch (e) {
        fail(e);
      }
    });
}
