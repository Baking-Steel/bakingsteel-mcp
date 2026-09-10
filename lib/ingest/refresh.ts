/**
 * Weekly public refresh: products.json + budgeted blog scrape.
 * Result is meant to be written to Vercel Blob (a file, not a DB / Shopify app).
 */

import type { Corpus, Doc } from "../types";
import { fetchProducts } from "./shopify";
import {
  listPublicArticleUrls,
  prioritizeArticleUrls,
  scrapeArticlesWithinBudget,
  type ScrapeBatchResult,
} from "./public-articles";

export interface PublicRefreshResult {
  corpus: Corpus;
  products: number;
  scrape: ScrapeBatchResult;
  recipes: number;
  articles: number;
  videos: number;
  sitemapUrls: number;
}

export async function refreshCorpusFromPublicWeb(
  priorDocs: Doc[],
): Promise<PublicRefreshResult> {
  const byId = new Map<string, Doc>();
  for (const doc of priorDocs) byId.set(doc.id, doc);

  const knownBlogIds = new Set(
    [...byId.keys()].filter((id) => id.startsWith("blog:")),
  );

  const [products, sitemapUrls] = await Promise.all([
    fetchProducts(),
    listPublicArticleUrls(),
  ]);

  for (const doc of products) byId.set(doc.id, doc);

  const ordered = prioritizeArticleUrls(sitemapUrls, knownBlogIds);
  const scrape = await scrapeArticlesWithinBudget(ordered, {
    // Leave ~60s headroom under Vercel's 300s function limit.
    budgetMs: 240_000,
    maxPages: 90,
    concurrency: 2,
    gapMs: 400,
  });

  for (const doc of scrape.scraped) byId.set(doc.id, doc);

  const docs = [...byId.values()];
  const corpus: Corpus = {
    generatedAt: new Date().toISOString(),
    docs,
  };

  return {
    corpus,
    products: products.length,
    scrape,
    recipes: docs.filter((d) => d.kind === "recipe").length,
    articles: docs.filter((d) => d.kind === "article").length,
    videos: docs.filter((d) => d.kind === "video").length,
    sitemapUrls: sitemapUrls.length,
  };
}
