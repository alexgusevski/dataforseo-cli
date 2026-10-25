import { getFormat, output } from "./formatters";
import { Row } from "./trim";

export interface EmitOptions {
  json?: boolean;
  table?: boolean;
  human?: boolean;
  limit?: number; // undefined = no limit
  fields?: string; // comma-separated column filter
  total?: number; // rows the API reports in total
}

// Union of keys in first-seen order, dropping columns that are empty in every row.
function columns(rows: Row[]): string[] {
  const seen: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.includes(k)) seen.push(k);
  return seen.filter((k) => rows.some((r) => r[k] !== undefined && r[k] !== null && r[k] !== ""));
}

function cell(v: any): any {
  if (typeof v === "string") return v.replace(/[\t\r\n]+/g, " ");
  return v;
}

// Returns the text for stdout; the "more rows" hint is appended for TSV/table output.
export function render(rows: Row[], opts: EmitOptions): { text: string; shown: number; more: number } {
  const limit = opts.limit && opts.limit > 0 ? opts.limit : undefined;
  const shownRows = limit ? rows.slice(0, limit) : rows;
  let more = rows.length - shownRows.length;
  if (opts.total !== undefined && opts.total > rows.length) more += opts.total - rows.length;

  let cols = columns(shownRows);
  if (opts.fields) {
    const want = opts.fields.split(",").map((f) => f.trim()).filter(Boolean);
    cols = want.filter((f) => shownRows.some((r) => f in r));
  }
  const normal = shownRows.map((r) => {
    const o: Row = {};
    for (const c of cols) o[c] = cell(r[c] ?? "");
    return o;
  });
  const fmt = getFormat(opts);
  if (fmt === "json") {
    const compact = normal.map((r) => {
      const o: Row = {};
      for (const [k, v] of Object.entries(r)) if (v !== "") o[k] = v;
      return o;
    });
    return { text: JSON.stringify(compact), shown: normal.length, more };
  }
  let text = normal.length ? output(normal, fmt) : "No results.";
  if (more > 0) text += `\n# ${more} more rows; raise --limit (now ${limit ?? rows.length}) to see them`;
  return { text, shown: normal.length, more };
}
