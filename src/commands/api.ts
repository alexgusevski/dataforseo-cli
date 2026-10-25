import * as fs from "fs";
import { Command } from "commander";
import { call, CliError } from "../client";
import { endpoints, lookup, normalisePath, queuePaths } from "../endpoints";
import { callOptions, callOpts, emit, fail, outputOptions, readBodyFile } from "../registry";
import { genericRows } from "../trim";

// TTL by API group, in hours.
export function ttlFor(path: string): number {
  if (/^appendix\//.test(path) || /\/task_get\//.test(path)) return 0;
  if (/(locations|languages|categories)/.test(path)) return 24 * 30;
  if (/^serp\/|^merchant\/|^ai_optimization\/(chat_gpt|gemini|claude|perplexity)/.test(path)) return 12;
  if (/^keywords_data\/(google_trends|dataforseo_trends)/.test(path)) return 24;
  if (/^keywords_data\/|^dataforseo_labs\/|^ai_optimization\/ai_keyword_data/.test(path)) return 24 * 30;
  if (/^domain_analytics\//.test(path)) return 24 * 30;
  if (/^backlinks\//.test(path)) return 24 * 7;
  return 24;
}

async function readStdin(timeoutMs = 2000): Promise<string> {
  let stat: fs.Stats;
  try {
    stat = fs.fstatSync(0);
  } catch {
    return "";
  }
  if (!stat.isFIFO() && !stat.isFile()) return "";
  return new Promise((resolve) => {
    let data = "";
    const timer = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function parseBody(text: string, from: string): any {
  try {
    return JSON.parse(text);
  } catch (e: any) {
    throw new CliError(`Invalid JSON in ${from}: ${e.message}`);
  }
}

export function registerApi(program: Command): void {
  const cmd = program
    .command("api")
    .description("Call ANY DataForSEO v3 endpoint (output is still trimmed). Use --list to find endpoints, --describe for params")
    .argument("[path]", "Endpoint path, e.g. serp/google/organic/live/advanced (or a filter with --list)")
    .option("--body <json>", "Request body: one task object or an array of tasks ('-' reads stdin)")
    .option("--body-file <file>", "Read the request body from a JSON file")
    .option("--list", "List endpoints (path argument filters them)")
    .option("--all", "With --list: include task_get/tasks_ready/locations helper endpoints")
    .option("--describe", "Show the request parameters of an endpoint")
    .option("-n, --limit <n>", "Max rows", "50");
  callOptions(outputOptions(cmd));
  cmd.addHelpText(
    "after",
    `
Examples:
  dataforseo-cli api --list trustpilot
  dataforseo-cli api --describe serp/google/jobs/live/advanced
  dataforseo-cli api serp/google/jobs/live/advanced --body '{"keyword":"seo manager","location_code":2840}'
  echo '[{"target":"example.com"}]' | dataforseo-cli api backlinks/summary/live`
  );

  cmd.action(async (rawPath: string | undefined, opts: any) => {
    try {
      const limit = parseInt(opts.limit);
      if (opts.list) {
        const q = (rawPath || "").toLowerCase();
        const rows = Object.entries(endpoints())
          .filter(([p]) => opts.all || !/(task_get|tasks_ready|tasks_fixed|\/errors|id_list|\{|locations|languages)/.test(p))
          .filter(([p, e]) => !q || p.includes(q) || e.d.toLowerCase().includes(q))
          .map(([p, e]) => ({
            path: p,
            method: e.m,
            queue: queuePaths(p) ? "yes" : "",
            about: e.d.slice(0, 110),
          }));
        emit({ rows }, { ...opts, quiet: true }, opts.limit === "50" && q ? 200 : limit);
        return;
      }
      if (!rawPath) throw new CliError("Give an endpoint path, or use --list to find one.");
      const path = normalisePath(rawPath);
      if (opts.describe) {
        const found = lookup(path);
        if (!found) throw new CliError(`Unknown endpoint ${path}. Find it with: dataforseo-cli api --list <filter>`);
        const rows = (found.ep.p || []).map(([name, type, req, desc]) => ({
          param: name,
          type,
          required: req === 1 ? "yes" : req === 2 ? "one-of" : "",
          about: opts.fullText ? desc : desc.slice(0, 120),
        }));
        console.log(`${found.ep.m} ${found.key}: ${found.ep.d}${queuePaths(path) ? " (queue: yes)" : ""}`);
        emit({ rows }, { ...opts, quiet: true }, 0);
        return;
      }

      let body: any;
      if (opts.body === "-") body = parseBody(await readStdin(30000), "stdin");
      else if (opts.body) body = parseBody(opts.body, "--body");
      else if (opts.bodyFile) body = readBodyFile(opts.bodyFile);
      else {
        const stdin = (await readStdin()).trim();
        if (stdin) body = parseBody(stdin, "stdin");
      }
      if (body !== undefined && !Array.isArray(body)) body = [body];

      const { response } = await call(path, body, callOpts(opts, ttlFor(path)));
      emit(genericRows(response, { fullText: !!opts.fullText }), opts, limit);
    } catch (e) {
      fail(e);
    }
  });
}
