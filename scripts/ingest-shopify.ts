/**
 * Pulls the Baking Steel catalog and every blog article into data/corpus.json.
 *
 * Reads public Shopify endpoints only, so this runs without credentials:
 *   - products.json for the catalog
 *   - sitemap_blogs_1.xml for the full article list
 *   - each article's embedded schema.org Article block for clean body text
 *
 * The Atom feeds look like the obvious source but silently cap at the newest
 * 30 entries per blog regardless of ?page=, so they are not used here.
 *
 *   npm run ingest:shopify
 */

import { XMLParser } from "fast-xml-parser";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Doc, ProductVariant } from "../lib/types";
import { htmlToText, summarize } from "./html";

/**
 * Article extraction is cached to disk so a throttled run resumes instead of
 * refetching from zero. Delete .cache/articles to force a full rebuild.
 */
const CACHE_DIR = join(process.cwd(), ".cache", "articles");

async function readCached(slug: string): Promise<Doc | null> {
  try {
    return JSON.parse(await readFile(join(CACHE_DIR, `${slug}.json`), "utf8")) as Doc;
  } catch {
    return null;
  }
}

async function writeCached(slug: string, doc: Doc): Promise<void> {
  await writeFile(join(CACHE_DIR, `${slug}.json`), JSON.stringify(doc));
}

const STORE = "https://bakingsteel.com";
const UA = { "user-agent": "bakingsteel-mcp/0.1" };

/** Node 20 has no --env-file-if-exists, and .env is optional here. */
async function loadEnv(): Promise<void> {
  try {
    const raw = await readFile(join(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      if (value && !process.env[match[1]]) process.env[match[1]] = value;
    }
  } catch {
    // No .env — the fallback path needs no credentials.
  }
}

/** The storefront returns 429 well before 8 workers; 3 sustains cleanly. */
const CONCURRENCY = 3;
const MAX_RETRIES = 4;

/**
 * Shopify's Retry-After can be minutes long. Honouring it verbatim parks a
 * worker for the whole window, so cap it and let the retry budget run out.
 */
const MAX_BACKOFF_MS = 10_000;

const parser = new XMLParser({ ignoreAttributes: false });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string): Promise<string> {
  let lastStatus = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: UA });
    if (res.ok) return res.text();

    lastStatus = res.status;
    // Throttling and transient upstream errors are worth waiting out.
    if (res.status !== 429 && res.status < 500) break;

    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 500 * 2 ** attempt;
    await sleep(Math.min(backoff, MAX_BACKOFF_MS));
  }

  throw new Error(`GET ${url} -> ${lastStatus}`);
}

async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url)) as T;
}

/** Runs tasks with a fixed worker pool, preserving input order. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------- products

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  product_type: string;
  tags: string[] | string;
  published_at: string;
  variants: { id: number; title: string; price: string; available: boolean }[];
  images: { src: string }[];
}

async function ingestProducts(): Promise<Doc[]> {
  const { products } = await fetchJson<{ products: ShopifyProduct[] }>(
    `${STORE}/products.json?limit=250`,
  );

  return products.map((p) => {
    const variants: ProductVariant[] = p.variants.map((v) => ({
      id: v.id,
      title: v.title,
      price: Number(v.price),
      available: v.available,
    }));
    const prices = variants.map((v) => v.price);
    const body = htmlToText(p.body_html);

    return {
      id: `product:${p.handle}`,
      kind: "product",
      title: p.title,
      url: `${STORE}/products/${p.handle}`,
      summary: summarize(body),
      body,
      tags: Array.isArray(p.tags)
        ? p.tags
        : String(p.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
      publishedAt: p.published_at,
      product: {
        handle: p.handle,
        productType: p.product_type,
        priceMin: prices.length ? Math.min(...prices) : 0,
        priceMax: prices.length ? Math.max(...prices) : 0,
        available: variants.some((v) => v.available),
        variants,
        imageUrl: p.images?.[0]?.src,
      },
    } satisfies Doc;
  });
}

// ---------------------------------------------------------------- articles

async function articleUrls(): Promise<string[]> {
  const xml = await fetchText(`${STORE}/sitemap_blogs_1.xml`);
  const parsed = parser.parse(xml);
  const entries = parsed?.urlset?.url;
  const list = Array.isArray(entries) ? entries : entries ? [entries] : [];

  return list
    .map((u: { loc?: string }) => String(u?.loc ?? ""))
    // Keep article pages (/blogs/{blog}/{slug}), drop blog index pages.
    .filter((loc: string) => /\/blogs\/[^/]+\/[^/]+$/.test(loc));
}

interface SchemaArticle {
  "@type"?: string;
  headline?: string;
  articleBody?: string;
  datePublished?: string;
  description?: string;
}

/**
 * The storefront emits its Article schema in <script type="application/json">
 * rather than ld+json, so match both. articleBody arrives as plain text with
 * newlines already in place.
 */
function extractArticle(html: string): SchemaArticle | null {
  const blocks = html.matchAll(
    /<script[^>]*type=["'](?:application\/ld\+json|application\/json)["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const block of blocks) {
    let parsedBlock: unknown;
    try {
      parsedBlock = JSON.parse(block[1].trim());
    } catch {
      continue;
    }

    const nodes = Array.isArray(parsedBlock) ? parsedBlock : [parsedBlock];
    for (const node of nodes) {
      const n = node as SchemaArticle;
      if (n?.["@type"] === "Article" && n.articleBody) return n;
    }
  }

  return null;
}

/**
 * Preferred path. The storefront rate-limits by IP well before the archive is
 * fully walked, so with a token we read articles straight from the Admin API
 * instead — a handful of paginated calls, and it carries real tags.
 */
async function ingestArticlesViaAdmin(token: string): Promise<Doc[]> {
  const endpoint = `${STORE}/admin/api/2025-01/graphql.json`;
  const query = `
    query Articles($cursor: String) {
      articles(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          handle
          title
          body
          summary
          publishedAt
          tags
          blog { handle }
        }
      }
    }
  `;

  interface ArticleNode {
    handle: string;
    title?: string;
    body?: string;
    summary?: string;
    publishedAt?: string;
    tags?: string[];
    blog?: { handle?: string };
  }

  interface ArticlesResponse {
    data?: { articles: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: ArticleNode[] } };
    errors?: unknown;
  }

  const docs: Doc[] = [];
  let cursor: string | null = null;

  do {
    const res: Response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-shopify-access-token": token,
      },
      body: JSON.stringify({ query, variables: { cursor } }),
    });

    if (!res.ok) throw new Error(`Admin API -> ${res.status} ${await res.text()}`);

    const payload = (await res.json()) as ArticlesResponse;
    if (payload.errors || !payload.data) {
      throw new Error(`Admin API: ${JSON.stringify(payload.errors)}`);
    }

    const page = payload.data.articles;
    for (const node of page.nodes) {
      const body = htmlToText(node.body ?? "");
      if (!body) continue;

      const blogHandle = node.blog?.handle ?? "recipes";
      docs.push({
        id: `blog:${node.handle}`,
        kind: blogHandle === "recipes" ? "recipe" : "article",
        title: node.title?.trim() ?? "",
        url: `${STORE}/blogs/${blogHandle}/${node.handle}`,
        summary: node.summary?.trim() || summarize(body),
        body,
        tags: [blogHandle, ...(node.tags ?? [])],
        publishedAt: node.publishedAt ?? undefined,
      });
    }

    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    console.log(`  ...${docs.length} articles`);
  } while (cursor);

  return docs.filter((d) => d.title && d.body);
}

async function ingestArticles(): Promise<Doc[]> {
  const urls = await articleUrls();
  console.log(`  found ${urls.length} article urls in sitemap`);

  await mkdir(CACHE_DIR, { recursive: true });

  let done = 0;
  let fromCache = 0;
  const failures: { url: string; reason: string }[] = [];

  const docs = await pool(urls, CONCURRENCY, async (url) => {
    const [, blogHandle, slug] = url.match(/\/blogs\/([^/]+)\/([^/]+)$/) ?? [];

    try {
      const cached = slug ? await readCached(slug) : null;
      if (cached) {
        fromCache++;
        return cached;
      }

      const article = extractArticle(await fetchText(url));
      if (!article?.articleBody) {
        failures.push({ url, reason: "no Article schema" });
        return null;
      }

      const body = article.articleBody.replace(/\n{3,}/g, "\n\n").trim();

      const doc = {
        id: `blog:${slug}`,
        // The recipes blog is the bulk; steel-info is care and technique.
        kind: blogHandle === "recipes" ? "recipe" : "article",
        title: (article.headline ?? "").trim(),
        url,
        summary: article.description?.trim() || summarize(body),
        body,
        tags: [blogHandle],
        publishedAt: article.datePublished,
      } satisfies Doc;

      if (slug) await writeCached(slug, doc);
      return doc;
    } catch (err) {
      failures.push({ url, reason: (err as Error).message });
      return null;
    } finally {
      if (++done % 50 === 0) console.log(`  ...${done}/${urls.length}`);
    }
  });

  if (fromCache) console.log(`  ${fromCache} served from .cache/articles`);

  if (failures.length) {
    console.log(`\n  ${failures.length} failed (rerun to retry — cached ones are skipped):`);
    for (const f of failures.slice(0, 10)) {
      console.log(`    ${f.reason}  ${f.url.replace(STORE, "")}`);
    }
    if (failures.length > 10) console.log(`    ...and ${failures.length - 10} more`);
  }

  return docs.filter((d): d is Doc => d !== null && Boolean(d.title) && Boolean(d.body));
}

// -------------------------------------------------------------------- main

async function main() {
  await loadEnv();
  console.log("Ingesting Baking Steel...\n");

  const products = await ingestProducts();
  console.log(`  products      ${products.length}\n`);

  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) {
    console.log("  SHOPIFY_ADMIN_TOKEN unset — falling back to storefront pages.");
    console.log("  The store rate-limits this path; expect partial results.\n");
  }

  const articles = token
    ? await ingestArticlesViaAdmin(token)
    : await ingestArticles();
  const recipes = articles.filter((d) => d.kind === "recipe").length;
  console.log(`\n  recipes       ${recipes}`);
  console.log(`  articles      ${articles.length - recipes}`);

  const out = join(process.cwd(), "data");
  const corpusPath = join(out, "corpus.json");

  // Merge over whatever is already committed. A partial run — the fallback path
  // gets throttled routinely — must never delete documents we already have.
  const existing = new Map<string, Doc>();
  try {
    const prior = JSON.parse(await readFile(corpusPath, "utf8")) as { docs: Doc[] };
    for (const doc of prior.docs) existing.set(doc.id, doc);
  } catch {
    // First run.
  }

  const before = existing.size;
  for (const doc of [...products, ...articles]) existing.set(doc.id, doc);

  const corpus = {
    generatedAt: new Date().toISOString(),
    docs: [...existing.values()],
  };

  await mkdir(out, { recursive: true });
  await writeFile(corpusPath, JSON.stringify(corpus, null, 2));

  if (before) console.log(`\n  merged with ${before} existing docs`);

  const bytes = Buffer.byteLength(JSON.stringify(corpus));
  console.log(
    `\n  ${corpus.docs.length} docs -> data/corpus.json (${(bytes / 1e6).toFixed(2)} MB)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
