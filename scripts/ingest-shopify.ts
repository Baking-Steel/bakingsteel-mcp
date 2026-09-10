/**
 * CLI ingest: writes data/corpus.json for local/dev and as the seed fallback.
 *
 * Prefer SHOPIFY_ADMIN_TOKEN (local .env only). Without it, falls back to
 * storefront HTML scraping — slow and rate-limited; production cron never
 * uses that path.
 *
 *   npm run ingest:shopify
 */

import { XMLParser } from "fast-xml-parser";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Doc } from "../lib/types";
import { summarize } from "../lib/html";
import {
  STORE,
  UA,
  fetchText,
  fetchProducts,
  fetchArticlesViaAdmin,
} from "../lib/ingest/shopify";

const CACHE_DIR = join(process.cwd(), ".cache", "articles");
const CONCURRENCY = 1;
const REQUEST_DELAY_MS = 2000;

const parser = new XMLParser({ ignoreAttributes: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    // No .env — public products still work; articles need Admin or scrape.
  }
}

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

async function seedCacheFromCorpus(): Promise<void> {
  let docs: Doc[];
  try {
    const raw = await readFile(join(process.cwd(), "data", "corpus.json"), "utf8");
    docs = (JSON.parse(raw) as { docs: Doc[] }).docs;
  } catch {
    return;
  }

  let seeded = 0;
  for (const doc of docs) {
    if (!doc.id.startsWith("blog:")) continue;
    const slug = doc.id.slice("blog:".length);
    if (await readCached(slug)) continue;
    await writeCached(slug, doc);
    seeded++;
  }

  if (seeded) console.log(`  seeded ${seeded} articles into cache from corpus`);
}

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

async function articleUrls(): Promise<string[]> {
  const xml = await fetchText(`${STORE}/sitemap_blogs_1.xml`);
  const parsed = parser.parse(xml);
  const entries = parsed?.urlset?.url;
  const list = Array.isArray(entries) ? entries : entries ? [entries] : [];

  return list
    .map((u: { loc?: string }) => String(u?.loc ?? ""))
    .filter((loc: string) => /\/blogs\/[^/]+\/[^/]+$/.test(loc));
}

interface SchemaArticle {
  "@type"?: string;
  headline?: string;
  articleBody?: string;
  datePublished?: string;
  description?: string;
}

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

/** Storefront scrape — CLI fallback only when Admin token is missing. */
async function ingestArticlesFromStorefront(): Promise<Doc[]> {
  const urls = await articleUrls();
  console.log(`  found ${urls.length} article urls in sitemap`);

  await mkdir(CACHE_DIR, { recursive: true });
  await seedCacheFromCorpus();

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

      const html = await fetchText(url);
      await sleep(REQUEST_DELAY_MS);

      const article = extractArticle(html);
      if (!article?.articleBody) {
        failures.push({ url, reason: "no Article schema" });
        return null;
      }

      const body = article.articleBody.replace(/\n{3,}/g, "\n\n").trim();

      const doc = {
        id: `blog:${slug}`,
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

async function refreshFavicon(): Promise<void> {
  try {
    const home = await fetchText(STORE);
    const href = home.match(
      /<link[^>]*rel="[^"]*icon[^"]*"[^>]*href="([^"]+)"/i,
    )?.[1];
    if (!href) return;

    const url = href.startsWith("//") ? `https:${href}` : href;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return;

    const bytes = Buffer.from(await res.arrayBuffer());
    await writeFile(join(process.cwd(), "app", "icon.png"), bytes);
    console.log(`  favicon      ${(bytes.length / 1024).toFixed(1)} KB`);
  } catch {
    // Non-fatal.
  }
}

async function main() {
  await loadEnv();
  console.log("Ingesting Baking Steel...\n");
  await refreshFavicon();

  const products = await fetchProducts();
  console.log(`  products      ${products.length}\n`);

  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) {
    console.log("  SHOPIFY_ADMIN_TOKEN unset — falling back to storefront pages.");
    console.log("  The store rate-limits this path; expect partial results.\n");
  }

  const articles = token
    ? await fetchArticlesViaAdmin(token)
    : await ingestArticlesFromStorefront();
  const recipes = articles.filter((d) => d.kind === "recipe").length;
  console.log(`\n  recipes       ${recipes}`);
  console.log(`  articles      ${articles.length - recipes}`);

  const out = join(process.cwd(), "data");
  const corpusPath = join(out, "corpus.json");

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
