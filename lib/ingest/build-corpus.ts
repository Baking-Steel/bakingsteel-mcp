/**
 * Build a fresh corpus for cron / CLI: live products + Admin articles,
 * preserving video (and any other non-product/blog) docs from the prior set.
 */

import type { Corpus, Doc } from "../types";
import { fetchArticlesViaAdmin, fetchProducts } from "./shopify";

export interface BuildCorpusResult {
  corpus: Corpus;
  products: number;
  recipes: number;
  articles: number;
  videos: number;
  preserved: number;
}

/**
 * @param priorDocs docs to merge over (seed or previous Blob). Videos are kept
 *   because YouTube refresh is still a separate CLI step.
 * @param adminToken required — cron must not fall back to HTML scraping.
 */
export async function buildCorpusFromShopify(
  priorDocs: Doc[],
  adminToken: string,
): Promise<BuildCorpusResult> {
  const [products, articles] = await Promise.all([
    fetchProducts(),
    fetchArticlesViaAdmin(adminToken),
  ]);

  const byId = new Map<string, Doc>();

  // Keep non-Shopify kinds (videos, etc.) from the prior corpus.
  for (const doc of priorDocs) {
    if (doc.kind === "video" || (!doc.id.startsWith("blog:") && doc.kind !== "product")) {
      byId.set(doc.id, doc);
    }
  }

  const preserved = byId.size;

  for (const doc of [...products, ...articles]) {
    byId.set(doc.id, doc);
  }

  const docs = [...byId.values()];
  const corpus: Corpus = {
    generatedAt: new Date().toISOString(),
    docs,
  };

  return {
    corpus,
    products: products.length,
    recipes: articles.filter((d) => d.kind === "recipe").length,
    articles: articles.filter((d) => d.kind === "article").length,
    videos: docs.filter((d) => d.kind === "video").length,
    preserved,
  };
}
