export function formatTable(data: Record<string, any>[]): string {
  if (data.length === 0) return "No results.";

  const keys = Object.keys(data[0]);
  const widths = keys.map((k) =>
    Math.max(
      k.length,
      ...data.map((row) => String(row[k] ?? "").length)
    )
  );

  const header = keys.map((k, i) => k.padEnd(widths[i])).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const rows = data.map((row) =>
    keys.map((k, i) => String(row[k] ?? "").padEnd(widths[i])).join("  ")
  );

  return [header, sep, ...rows].join("\n");
}

export function formatTsv(data: Record<string, any>[]): string {
  if (data.length === 0) return "";

  const keys = Object.keys(data[0]);
  const header = keys.join("\t");
  const rows = data.map((row) =>
    keys.map((k) => String(row[k] ?? "")).join("\t")
  );

  return [header, ...rows].join("\n");
}

export function formatJson(data: any): string {
  return JSON.stringify(data);
}

export type OutputFormat = "tsv" | "json" | "table";

export function getFormat(opts: { json?: boolean; table?: boolean; human?: boolean }): OutputFormat {
  if (opts.json) return "json";
  if (opts.table || opts.human) return "table";
  return "tsv";
}

export function output(data: Record<string, any>[], format: OutputFormat): string {
  switch (format) {
    case "json": return formatJson(data);
    case "table": return formatTable(data);
    case "tsv": return formatTsv(data);
  }
}
