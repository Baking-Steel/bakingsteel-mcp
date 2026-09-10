/**
 * Public blog scrape — sitemap + per-page Article JSON. No Admin API.
 * Designed for Vercel Cron: stop before the 5-minute platform limit.
 */

import { XMLParser } from "fast-xml-parser";
import type { Doc } from "../types";
import { summarize } from "../html";
import { STORE, fetchText } from "./shopify";

const parser = new XMLParser({ ignoreAttributes: false });

export async function listPublicArticleUrls(): Promise<string[]> {
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

export async function scrapePublicArticle(url: string): Promise<Doc | null> {
  const [, blogHandle, slug] = url.match(/\/blogs\/([^/]+)\/([^/]+)$/) ?? [];
  if (!slug || !blogHandle) return null;

  const html = await fetchText(url);
  const article = extractArticle(html);
  if (!article?.articleBody) return null;

  const body = article.articleBody.replace(/\n{3,}/g, "\n\n").trim();
  if (!body) return null;

  return {
    id: `blog:${slug}`,
    kind: blogHandle === "recipes" ? "recipe" : "article",
    title: (article.headline ?? "").trim(),
    url,
    summary: article.description?.trim() || summarize(body),
    body,
    tags: [blogHandle],
    publishedAt: article.datePublished,
  };
}

export interface ScrapeBatchOptions {
  /** Wall-clock budget; leave headroom under Vercel's 300s max. */
  budgetMs?: number;
  /** Hard cap on pages fetched this run. */
  maxPages?: number;
  concurrency?: number;
  /** Pause between starting each fetch — stay polite to the storefront. */
  gapMs?: number;
}

export interface ScrapeBatchResult {
  scraped: Doc[];
  attempted: number;
  failed: number;
  skippedBudget: number;
  remaining: number;
}

/**
 * Prefer URLs missing from `knownIds`, then rotate through the rest so a
 * weekly job walks the archive over a few runs without timing out.
 */
export function prioritizeArticleUrls(
  urls: string[],
  knownIds: Set<string>,
): string[] {
  const missing: string[] = [];
  const known: string[] = [];

  for (const url of urls) {
    const slug = url.match(/\/blogs\/[^/]+\/([^/]+)$/)?.[1];
    const id = slug ? `blog:${slug}` : "";
    if (id && !knownIds.has(id)) missing.push(url);
    else known.push(url);
  }

  // Rotate known set by week-of-year so we revalidate different slices.
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const offset = known.length ? week % known.length : 0;
  const rotated = [...known.slice(offset), ...known.slice(0, offset)];

  return [...missing, ...rotated];
}

export async function scrapeArticlesWithinBudget(
  urls: string[],
  options: ScrapeBatchOptions = {},
): Promise<ScrapeBatchResult> {
  const budgetMs = options.budgetMs ?? 240_000;
  const maxPages = options.maxPages ?? 90;
  const concurrency = options.concurrency ?? 2;
  const gapMs = options.gapMs ?? 400;
  const deadline = Date.now() + budgetMs;

  const queue = urls.slice(0, Math.min(urls.length, maxPages));
  const scraped: Doc[] = [];
  let attempted = 0;
  let failed = 0;
  let cursor = 0;
  let skippedBudget = 0;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function worker() {
    while (true) {
      if (Date.now() >= deadline) {
        skippedBudget += Math.max(0, queue.length - cursor);
        return;
      }

      const i = cursor++;
      if (i >= queue.length) return;

      // Stagger starts so we do not stampede the storefront.
      if (i > 0) await sleep(gapMs);

      if (Date.now() >= deadline) {
        skippedBudget += queue.length - i;
        return;
      }

      const url = queue[i];
      attempted++;
      try {
        const doc = await scrapePublicArticle(url);
        if (doc?.title && doc.body) scraped.push(doc);
        else failed++;
      } catch {
        failed++;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, queue.length || 1) },
    () => worker(),
  );
  await Promise.all(workers);

  return {
    scraped,
    attempted,
    failed,
    skippedBudget: Math.max(skippedBudget, urls.length - queue.length),
    remaining: Math.max(0, urls.length - attempted),
  };
}
