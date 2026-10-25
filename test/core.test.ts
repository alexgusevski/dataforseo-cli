import { describe, expect, it } from "vitest";
import { cleanUrl, domainOf, genericRows, round, stripMarkdown, truncate } from "../src/trim";
import { render } from "../src/output";
import { explain } from "../src/client";
import { lookup, normalisePath, queuePaths } from "../src/endpoints";
import { estimate, priceFor } from "../src/prices";
import { makeRequestKey } from "../src/cache";
import { geo } from "../src/registry";

const envelope = (result: any[]) => ({
  version: "0.1.20260101",
  status_code: 20000,
  status_message: "Ok.",
  time: "1.2 sec.",
  cost: 0.01,
  tasks_count: 1,
  tasks_error: 0,
  tasks: [{ id: "abc", status_code: 20000, status_message: "Ok.", time: "1 sec.", cost: 0.01, result_count: 1, path: ["v3"], data: { api: "x" }, result }],
});

describe("genericRows", () => {
  it("strips the envelope and noise, flattens, drops empties", () => {
    const resp = envelope([
      {
        keyword: "seo",
        se_domain: "google.com",
        check_url: "https://www.google.com/search?q=seo",
        datetime: "2026-10-25",
        items_count: 2,
        items: [
          { type: "organic", rank_group: 1, rank_absolute: 3, xpath: "/html", domain: "a.com", url: "https://a.com", title: "A", description: null, rating: { value: 4.5, votes_count: 10 }, is_image: false, links: [] },
          { type: "organic", rank_group: 2, rank_absolute: 4, xpath: "/html", domain: "b.com", url: "https://b.com", title: "B", extra: { nested: { deep: { deeper: "x" } } } },
        ],
      },
    ]);
    const { rows } = genericRows(resp);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ type: "organic", rank_group: 1, domain: "a.com", url: "https://a.com", title: "A", "rating.value": 4.5, "rating.votes_count": 10 });
    for (const r of rows) for (const k of ["xpath", "rank_absolute", "check_url", "is_image", "description"]) expect(r).not.toHaveProperty(k);
  });

  it("uses the result object itself when there are no items", () => {
    const { rows } = genericRows(envelope([{ target: "x.com", rank: 300, backlinks: 1234, info: { server: "nginx" } }]));
    expect(rows).toEqual([{ target: "x.com", rank: 300, backlinks: 1234, "info.server": "nginx" }]);
  });

  it("drops request echoes that are constant across rows but keeps varying ones", () => {
    const resp = envelope([
      { location_code: 2840, keyword: "a", search_volume: 10 },
      { location_code: 2840, keyword: "b", search_volume: 0 },
    ]);
    const { rows } = genericRows(resp);
    expect(rows).toEqual([{ keyword: "a", search_volume: 10 }, { keyword: "b", search_volume: 0 }]);
    const locs = genericRows(envelope([{ location_code: 1, location_name: "A" }, { location_code: 2, location_name: "B" }]));
    expect(locs.rows[1]).toEqual({ location_code: 2, location_name: "B" });
  });

  it("never prints the account login", () => {
    const { rows } = genericRows(envelope([{ login: "me@example.com", money: { balance: 3 } }]));
    expect(JSON.stringify(rows)).not.toContain("example.com");
  });
});

describe("text helpers", () => {
  it("truncates long text unless full text is asked for", () => {
    const long = "word ".repeat(100);
    expect(truncate(long).length).toBeLessThanOrEqual(160);
    expect(truncate(long, { fullText: true }).length).toBeGreaterThan(400);
  });
  it("rounds sensibly", () => {
    expect(round(2.34567)).toBe(2.35);
    expect(round(0.001234)).toBe(0.00123);
    expect(round(7)).toBe(7);
  });
  it("strips markdown and tracking params", () => {
    expect(stripMarkdown("![img](http://x) Safe `dose`.[[1]](http://y) See [Mayo](http://m)")).toBe("Safe dose. See Mayo");
    expect(cleanUrl("https://a.com/p?srsltid=abc")).toBe("https://a.com/p");
    expect(cleanUrl("https://a.com/p?id=1&utm_source=x")).toBe("https://a.com/p?id=1");
    expect(domainOf("https://www.example.com/a")).toBe("example.com");
  });
});

describe("render", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ k: `kw${i}`, v: i, empty: "" }));
  it("limits rows, drops empty columns and says how many more exist", () => {
    const { text, shown, more } = render(rows, { limit: 5 });
    expect(shown).toBe(5);
    expect(more).toBe(25);
    expect(text.split("\n")[0]).toBe("k\tv");
    expect(text).toContain("# 25 more rows");
  });
  it("counts rows the API reports beyond what was fetched", () => {
    expect(render(rows, { limit: 30, total: 100 }).more).toBe(70);
  });
  it("selects --fields and prints compact JSON without the hint", () => {
    const { text } = render(rows, { limit: 2, fields: "v", json: true });
    expect(JSON.parse(text)).toEqual([{ v: 0 }, { v: 1 }]);
  });
  it("replaces tabs and newlines inside cells", () => {
    expect(render([{ a: "x\ty\nz" }], {}).text).toBe("a\nx y z");
  });
});

describe("errors", () => {
  it("explains subscription, balance and location errors in one line", () => {
    expect(explain(40204, "Access denied. Visit Plans and Subscriptions to activate your subscription and get access to this API", "backlinks/summary/live")).toMatch(/no access to the backlinks API/);
    expect(explain(40200, "Payment Required.", "serp/google/organic/live/advanced")).toMatch(/Out of balance/);
    expect(explain(40501, "Invalid Field: 'location_code'.", "dataforseo_labs/google/keyword_ideas/live")).toMatch(/locations <name> --api labs/);
    for (const m of [explain(40100, "Not authorized", "x"), explain(40501, "Invalid Field: 'foo'.", "serp/x")]) expect(m).not.toContain("\n");
  });
});

describe("endpoint catalogue", () => {
  it("normalises paths", () => {
    expect(normalisePath("/v3/serp/google/organic/live/advanced/")).toBe("serp/google/organic/live/advanced");
    expect(normalisePath("https://api.dataforseo.com/v3/appendix/user_data")).toBe("appendix/user_data");
  });
  it("matches templated paths", () => {
    expect(lookup("serp/google/organic/task_get/advanced/123-abc")?.key).toBe("serp/google/organic/task_get/advanced/{id}");
  });
  it("derives queue paths for live and queue-only endpoints", () => {
    const q = queuePaths("serp/google/organic/live/advanced")!;
    expect(q.post).toBe("serp/google/organic/task_post");
    expect(q.get("X")).toBe("serp/google/organic/task_get/advanced/X");
    expect(queuePaths("keywords_data/google_ads/search_volume/live")!.get("X")).toBe("keywords_data/google_ads/search_volume/task_get/X");
    expect(queuePaths("business_data/trustpilot/reviews/task_post")!.get("X")).toBe("business_data/trustpilot/reviews/task_get/X");
    expect(queuePaths("dataforseo_labs/google/keyword_ideas/live")).toBeNull();
  });
});

describe("prices", () => {
  const tree = {
    serp: { live: { advanced: { priority_normal: [{ cost_type: "per_request", cost: 0.002 }] } } },
    dataforseo_labs: { keyword_ideas: { live: { priority_normal: [{ cost_type: "per_result", cost: 0.0001 }, { cost_type: "per_request", cost: 0.01 }] } } },
  };
  it("walks the tree skipping segments it does not split on", () => {
    expect(priceFor(tree, "serp/google/organic/live/advanced")).toEqual({ perRequest: 0.002, perResult: 0 });
  });
  it("estimates per task and per expected result", () => {
    expect(estimate(tree, "dataforseo_labs/google/keyword_ideas/live", [{ limit: 10 }, { limit: 10 }])).toBeCloseTo(0.022);
    expect(estimate(tree, "nope/x", [{}])).toBeNull();
  });
});

describe("cache keys", () => {
  it("ignore key order and keyword case", () => {
    expect(makeRequestKey("a/b", [{ keyword: "SEO ", location_code: 1 }])).toBe(makeRequestKey("/a/b/", [{ location_code: 1, keyword: "seo" }]));
    expect(makeRequestKey("a/b", [{ keyword: "seo" }])).not.toBe(makeRequestKey("a/b", [{ keyword: "sem" }]));
  });
});

describe("geo options", () => {
  it("accepts codes or names", () => {
    expect(geo({ location: "2752", language: "sv" })).toEqual({ location_code: 2752, language_code: "sv" });
    expect(geo({ location: "Stockholm,Stockholm County,Sweden", language: "Swedish" })).toEqual({ location_name: "Stockholm,Stockholm County,Sweden", language_name: "Swedish" });
    expect(geo({ location: "2840", language: "en_US" })).toEqual({ location_code: 2840, language_code: "en_US" });
  });
});

describe("api key=value fields", () => {
  it("parses JSON values and keeps plain strings", async () => {
    const { fieldArgs } = await import("../src/commands/api");
    expect(fieldArgs(["keyword=seo manager", "location_code=2840", 'keywords=["a","b"]', "load_async_ai_overview=true"])).toEqual({
      keyword: "seo manager",
      location_code: 2840,
      keywords: ["a", "b"],
      load_async_ai_overview: true,
    });
    expect(() => fieldArgs(["nokey"])).toThrow(/key=value/);
  });
});
