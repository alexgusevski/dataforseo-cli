import { Command } from "commander";
import { Ctx, Mapped, register, TypedCommand } from "../registry";
import { date, domainOf, fromItems, get, pick, truncate } from "../map";
import { items, Row } from "../trim";

const TTL = 12;

const price = (i: any) => {
  const from = i.price_from ?? i.price?.current ?? i.price;
  const to = i.price_to;
  if (from === undefined || from === null || typeof from === "object") return "";
  return to && to !== from ? `${from}-${to}` : from;
};

const badges = (i: any) =>
  [i.is_best_seller && "best_seller", i.is_amazon_choice && "amazon_choice", i.type === "amazon_paid" && "sponsored"].filter(Boolean).join(",");

// Best Sellers Rank lives in the product_information sections as a free-text value.
function bsr(i: any): string {
  for (const sec of i.product_information || []) {
    for (const [k, v] of Object.entries<any>(sec.body || {})) {
      if (/best sellers rank/i.test(k)) return String(v).replace(/\s*\(\s*See Top 100[^)]*\)/gi, "").replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

function brand(i: any): string {
  for (const sec of i.product_information || []) {
    for (const [k, v] of Object.entries<any>(sec.body || {})) if (/^(brand|manufacturer)$/i.test(k)) return String(v);
  }
  return i.brand || "";
}

function amazon(def: Omit<TypedCommand, "ttl"> & { ttl?: number }): TypedCommand {
  return { ttl: TTL, geoDefault: { location: "2840", language: "en_US" }, apiLimit: false, ...def };
}

export function registerMerchant(program: Command): void {
  const g = program.command("merchant").description("Merchant API: Amazon products, product details, sellers; Google Shopping products and sellers");

  register(g, amazon({
    name: "amazon-products",
    aliases: ["amazon"],
    desc: "Amazon search results for a keyword (price, rating, reviews, badges)",
    path: "merchant/amazon/products/live/advanced",
    args: ["<keyword>"],
    options: [["--depth <n>", "Results to fetch", "20"], ["--sort-by <by>", "relevance, price_low_to_high, price_high_to_low, featured, avg_customer_review, newest_arrival"]],
    limit: 20,
    columns: "pos, asin, title, price, rating, reviews, badges",
    body: ({ args, opts }) => ({ keyword: args[0], depth: parseInt(opts.depth), ...(opts.sortBy ? { sort_by: opts.sortBy } : {}) }),
    map: fromItems(
      {
        pos: "rank_group",
        asin: "data_asin|asin",
        title: (i: any, ctx: Ctx) => truncate(i.title, ctx.trim, 110),
        price,
        rating: "rating.value",
        reviews: "rating.votes_count",
        badges,
      },
      (i) => /^amazon_(serp|paid)$/.test(i.type)
    ),
  }));

  register(g, amazon({
    name: "amazon-product",
    aliases: ["asin"],
    desc: "Amazon product details for an ASIN: price, rating, BSR, brand, categories, top reviews",
    path: "merchant/amazon/asin/live/advanced",
    args: ["<asin>"],
    options: [["--reviews", "List the top reviews shown on the product page instead"]],
    limit: 20,
    columns: "asin, title, brand, price, rating, reviews, bsr, available, categories, description (or with --reviews: date, rating, title, text, verified)",
    body: ({ args }) => ({ asin: args[0] }),
    map: (resp: any, ctx: Ctx): Mapped => {
      const rows: Row[] = [];
      for (const i of items(resp)) {
        if (ctx.opts.reviews) {
          for (const r of [...(i.top_local_reviews || []), ...(i.top_global_reviews || [])]) {
            rows.push(pick(r, {
              date: (x: any) => date(x.publication_date) || x.publication_date,
              rating: "rating.value",
              title: "title",
              text: "review_text",
              verified: "verified",
              helpful: "helpful_votes",
            }, ctx));
          }
          continue;
        }
        rows.push(pick(i, {
          asin: "data_asin|asin",
          title: (x: any) => truncate(x.title, ctx.trim, 140),
          brand,
          price,
          rating: "rating.value",
          reviews: "rating.votes_count",
          bsr,
          available: "is_available",
          categories: (x: any) => (x.categories || []).map((c: any) => c.category).join(" > "),
          description: "description",
        }, ctx));
      }
      return { rows };
    },
  }));

  register(g, amazon({
    name: "amazon-sellers",
    desc: "Sellers offering an ASIN (price, condition, ships from, seller rating)",
    path: "merchant/amazon/sellers/live/advanced",
    args: ["<asin>"],
    limit: 20,
    columns: "seller, price, condition, ships_from, rating, ratings",
    body: ({ args }) => ({ asin: args[0] }),
    map: fromItems({
      seller: "seller_name",
      price: (i: any) => get(i, "price.current") ?? "",
      condition: "condition",
      ships_from: "ships_from",
      rating: "rating.value",
      ratings: "rating.votes_count",
    }),
  }));

  register(g, {
    name: "google-products",
    aliases: ["shopping"],
    desc: "Google Shopping results for a keyword (queue task; takes ~1 minute)",
    path: "merchant/google/products/task_post",
    args: ["<keyword>"],
    options: [["--depth <n>", "Results to fetch", "20"]],
    limit: 20,
    apiLimit: false,
    ttl: TTL,
    columns: "pos, title, price, seller, rating, reviews, product_id",
    body: ({ args, opts }) => ({ keyword: args[0], depth: parseInt(opts.depth) }),
    map: fromItems({
      pos: "rank_group",
      title: (i: any, ctx: Ctx) => truncate(i.title, ctx.trim, 110),
      price: "price",
      seller: "seller",
      rating: "product_rating.value|rating.value",
      reviews: "product_rating.votes_count|reviews_count|rating.votes_count",
      product_id: "product_id",
    }, (i) => !!i.product_id),
  });

  register(g, {
    name: "google-sellers",
    desc: "Sellers of a Google Shopping product (by product_id from google-products; queue task)",
    path: "merchant/google/sellers/task_post",
    args: ["<product_id>"],
    limit: 20,
    apiLimit: false,
    ttl: TTL,
    columns: "seller, domain, price, total_price, shipping, rating",
    body: ({ args }) => ({ product_id: args[0] }),
    map: fromItems({
      seller: "seller_name|title",
      domain: "domain",
      price: "price|base_price",
      total_price: "total_price",
      shipping: "delivery_info.delivery_message|shipping_price",
      rating: "rating.value",
    }),
  });

  register(g, {
    name: "google-product",
    desc: "Google Shopping product details (by product_id; queue task)",
    path: "merchant/google/product_info/task_post",
    args: ["<product_id>"],
    limit: 0,
    apiLimit: false,
    ttl: TTL,
    body: ({ args }) => ({ product_id: args[0] }),
  });
}

export function registerAppData(program: Command): void {
  const g = program.command("app-data").alias("apps").description("App Data API: Apple App Store and Google Play search, app info, reviews, listings");

  for (const store of ["apple", "google"] as const) {
    const A = `app_data/${store}`;
    const label = store === "apple" ? "App Store" : "Google Play";

    register(g, {
      name: `${store}-search`,
      desc: `${label} search results for a keyword (queue task)`,
      path: `${A}/app_searches/task_post`,
      args: ["<keyword>"],
      options: [["--depth <n>", "Results to fetch", "20"]],
      limit: 20,
      apiLimit: false,
      ttl: 24,
      columns: "pos, app_id, title, developer, rating, reviews, price",
      body: ({ args, opts }) => ({ keyword: args[0], depth: parseInt(opts.depth) }),
      map: fromItems({
        pos: "rank_group",
        app_id: "app_id",
        title: "title",
        developer: "developer",
        rating: "rating.value",
        reviews: "reviews_count|rating.votes_count",
        price: (i: any) => (i.is_free ? "free" : get(i, "price.current") ?? ""),
      }),
    });

    register(g, {
      name: `${store}-info`,
      desc: `${label} app details (queue task)`,
      path: `${A}/app_info/task_post`,
      args: ["<app_id>"],
      limit: 0,
      apiLimit: false,
      ttl: 24,
      columns: "app_id, title, developer, rating, reviews, installs, price, version, updated, released, categories, description",
      body: ({ args }) => ({ app_id: args[0] }),
      map: fromItems({
        app_id: "app_id",
        title: "title",
        developer: "developer",
        rating: "rating.value",
        reviews: "reviews_count|rating.votes_count",
        installs: "installs",
        price: (i: any) => (i.is_free ? "free" : get(i, "price.current") ?? ""),
        version: "version",
        updated: (i: any) => date(i.last_update_date),
        released: (i: any) => date(i.released_date),
        categories: "categories",
        description: "description",
      }),
    });

    register(g, {
      name: `${store}-reviews`,
      desc: `${label} reviews for an app (queue task; --depth reviews, billed per 100 on Apple / 150 on Google)`,
      path: `${A}/app_reviews/task_post`,
      args: ["<app_id>"],
      options: [["--depth <n>", "Reviews to fetch", "50"], ["--sort-by <by>", store === "apple" ? "most_recent or most_helpful" : "newest or most_relevant"]],
      limit: 50,
      apiLimit: false,
      ttl: 24,
      columns: "date, rating, title, text, version, helpful",
      body: ({ args, opts }) => ({ app_id: args[0], depth: parseInt(opts.depth), ...(opts.sortBy ? { sort_by: opts.sortBy } : {}) }),
      map: fromItems({
        date: (i: any) => date(i.timestamp),
        rating: "rating.value",
        title: "title",
        text: "review_text",
        version: "version",
        helpful: "helpful_count",
      }),
    });

    register(g, {
      name: `${store}-listings`,
      desc: `${label} app listings database search by title/description keyword or category ($0.10+ per call)`,
      path: `${A}/app_listings/search/live`,
      args: ["[title]"],
      geo: "none",
      options: [["--description <text>", "Keyword in the app description"], ["--category <name>", "App category"]],
      limit: 20,
      ttl: 24,
      columns: "app_id, title, developer, rating, reviews, installs, price, category",
      body: ({ args, opts }) => ({
        ...(args[0] ? { title: args[0] } : {}),
        ...(opts.description ? { description: opts.description } : {}),
        ...(opts.category ? { categories: [opts.category] } : {}),
      }),
      // listings wrap each app in an `item` object
      map: fromItems({
        app_id: "app_id",
        title: "item.title",
        developer: "item.developer",
        rating: "item.rating.value",
        reviews: "item.reviews_count|item.rating.votes_count",
        installs: "item.installs",
        price: (i: any) => (i.item?.is_free ? "free" : get(i, "item.price.current") ?? ""),
        category: "item.categories|item.main_category",
      }),
    });
  }
}

export function registerBusiness(program: Command): void {
  const g = program
    .command("business-data")
    .alias("business")
    .description("Business Data API: Trustpilot, Google reviews and business profiles, Tripadvisor, business listings");

  register(g, {
    name: "trustpilot-search",
    desc: "Find Trustpilot business profiles by name or category (queue task)",
    path: "business_data/trustpilot/search/task_post",
    args: ["<keyword>"],
    geo: "none",
    options: [["--depth <n>", "Results to fetch", "20"]],
    limit: 20,
    apiLimit: false,
    ttl: 24,
    columns: "pos, name, domain, rating, reviews",
    body: ({ args, opts }) => ({ keyword: args[0], depth: parseInt(opts.depth) }),
    map: fromItems({ pos: "rank_group", name: "title", domain: (i: any) => domainOf(i.domain), rating: "rating.value", reviews: "reviews_count|rating.votes_count" }),
  });

  register(g, {
    name: "trustpilot-reviews",
    desc: "Trustpilot reviews of a domain (queue task; billed per 20 reviews)",
    path: "business_data/trustpilot/reviews/task_post",
    args: ["<domain>"],
    geo: "none",
    options: [["--depth <n>", "Reviews to fetch", "40"], ["--sort-by <by>", "recency or relevance", "recency"]],
    limit: 40,
    apiLimit: false,
    ttl: 24,
    columns: "date, rating, title, text, country, verified, replied",
    body: ({ args, opts }) => ({ domain: args[0], depth: parseInt(opts.depth), sort_by: opts.sortBy }),
    map: fromItems({
      date: (i: any) => date(i.timestamp),
      rating: "rating.value",
      title: "title",
      text: "review_text",
      country: "user_profile.location",
      verified: "verified",
      replied: (i: any) => (i.responses || []).length > 0,
    }),
  });

  register(g, {
    name: "google-reviews",
    desc: "Google reviews of a business by name (+ --location) or --cid/--place-id (queue task)",
    path: "business_data/google/reviews/task_post",
    args: ["[business]"],
    options: [
      ["--cid <cid>", "Google business CID"],
      ["--place-id <id>", "Google place_id"],
      ["--depth <n>", "Reviews to fetch (billed per 10)", "40"],
      ["--sort-by <by>", "newest, highest_rating, lowest_rating, relevant", "newest"],
    ],
    limit: 40,
    apiLimit: false,
    ttl: 24,
    columns: "date, rating, text, owner_answered, reviewer_reviews",
    body: ({ args, opts }) => ({
      ...(args[0] ? { keyword: args[0] } : {}),
      ...(opts.cid ? { cid: opts.cid } : {}),
      ...(opts.placeId ? { place_id: opts.placeId } : {}),
      depth: parseInt(opts.depth),
      sort_by: opts.sortBy,
    }),
    map: fromItems({
      date: (i: any) => date(i.timestamp),
      rating: "rating.value",
      text: "review_text|original_review_text",
      owner_answered: (i: any) => !!i.owner_answer,
      reviewer_reviews: "reviews_count",
    }),
  });

  register(g, {
    name: "google-business",
    aliases: ["gmb"],
    desc: "Google Business Profile info for a business name (+ --location)",
    path: "business_data/google/my_business_info/live",
    args: ["<business>"],
    limit: 0,
    apiLimit: false,
    ttl: 24 * 7,
    columns: "title, category, rating, reviews, address, phone, domain, claimed, price_level, cid, place_id",
    body: ({ args }) => ({ keyword: args[0] }),
    map: fromItems({
      title: "title",
      category: "category",
      rating: "rating.value",
      reviews: "rating.votes_count",
      address: "address",
      phone: "phone",
      domain: "domain",
      claimed: "is_claimed",
      price_level: "price_level",
      cid: (i: any) => i.cid,
      place_id: (i: any) => i.place_id,
    }),
  });

  register(g, {
    name: "tripadvisor-search",
    desc: "Find Tripadvisor listings (queue task)",
    path: "business_data/tripadvisor/search/task_post",
    args: ["<keyword>"],
    geo: "location",
    options: [["--depth <n>", "Results to fetch", "20"]],
    limit: 10,
    apiLimit: false,
    ttl: 24,
    columns: "pos, title, rating, reviews, category, url_path",
    body: ({ args, opts }) => ({ keyword: args[0], depth: parseInt(opts.depth) }),
    map: fromItems({
      pos: "rank_group",
      title: "title",
      rating: "rating.value",
      reviews: "reviews_count|rating.votes_count",
      category: "category",
      url_path: "url_path",
    }),
  });

  register(g, {
    name: "tripadvisor-reviews",
    desc: "Tripadvisor reviews by url_path (from tripadvisor-search) or keyword (queue task)",
    path: "business_data/tripadvisor/reviews/task_post",
    args: ["<url_path_or_keyword>"],
    geo: "location",
    options: [["--depth <n>", "Reviews to fetch", "40"]],
    limit: 40,
    apiLimit: false,
    ttl: 24,
    columns: "date, rating, title, text, visit",
    body: ({ args, opts }) => ({
      ...(String(args[0]).startsWith("/") ? { url_path: args[0] } : { keyword: args[0] }),
      depth: parseInt(opts.depth),
    }),
    map: fromItems({
      date: (i: any) => date(i.timestamp),
      rating: "rating.value",
      title: "title",
      text: "review_text",
      visit: (i: any) => date(i.date_of_visit).slice(0, 7),
    }),
  });

  register(g, {
    name: "listings",
    desc: "Business listings database search by category/title (filters via --param filters='[...]')",
    path: "business_data/business_listings/search/live",
    args: ["[title]"],
    geo: "none",
    options: [["--category <name>", "Business category, e.g. pizza_restaurant"], ["--description <text>", "Keyword in the description"]],
    limit: 20,
    ttl: 24 * 7,
    columns: "title, category, rating, reviews, address, phone, domain, claimed",
    body: ({ args, opts }) => ({
      ...(args[0] ? { title: args[0] } : {}),
      ...(opts.category ? { categories: [opts.category] } : {}),
      ...(opts.description ? { description: opts.description } : {}),
    }),
    map: fromItems({
      title: "title",
      category: "category",
      rating: "rating.value",
      reviews: "rating.votes_count",
      address: "address",
      phone: "phone",
      domain: "domain",
      claimed: "is_claimed",
    }),
  });
}
