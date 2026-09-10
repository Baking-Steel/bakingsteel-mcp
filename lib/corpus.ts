/**
 * Corpus loader for the MCP runtime.
 *
 * 1. Prefer a cron-refreshed corpus from Vercel Blob (recipes/articles).
 * 2. Fall back to the committed seed in data/corpus.json.
 * 3. Overlay live products from the public products.json (no secrets).
 *
 * In-memory caches keep cold starts cheap and avoid hammering Shopify.
 */

import seedData from "@/data/corpus.json";
import type { Corpus, Doc } from "./types";
import { SearchIndex } from "./search";
import { readCorpusFromBlob } from "./blob-corpus";
import { fetchProducts, STORE } from "./ingest/shopify";

export const STORE_URL = STORE;

/** Attribution so revenue from the assistant is measurable in Shopify. */
export const REF = "utm_source=claude&utm_medium=mcp";

const CORPUS_TTL_MS = 5 * 60 * 1000;
const PRODUCTS_TTL_MS = 5 * 60 * 1000;

const seed = seedData as unknown as Corpus;

interface Cached<T> {
  value: T;
  fetchedAt: number;
}

let baseCache: Cached<{ corpus: Corpus; source: "blob" | "seed" }> | null = null;
let productsCache: Cached<Doc[]> | null = null;
let indexCache: Cached<{
  index: SearchIndex;
  generatedAt: string;
  source: "blob" | "seed";
  productsLive: boolean;
}> | null = null;

function fresh<T>(cache: Cached<T> | null, ttl: number): T | null {
  if (!cache) return null;
  if (Date.now() - cache.fetchedAt > ttl) return null;
  return cache.value;
}

async function loadBaseCorpus(): Promise<{ corpus: Corpus; source: "blob" | "seed" }> {
  const hit = fresh(baseCache, CORPUS_TTL_MS);
  if (hit) return hit;

  const fromBlob = await readCorpusFromBlob();
  const value = fromBlob?.docs?.length
    ? { corpus: fromBlob, source: "blob" as const }
    : { corpus: seed, source: "seed" as const };

  baseCache = { value, fetchedAt: Date.now() };
  return value;
}

async function loadLiveProducts(): Promise<Doc[] | null> {
  const hit = fresh(productsCache, PRODUCTS_TTL_MS);
  if (hit) return hit;

  try {
    const products = await fetchProducts();
    productsCache = { value: products, fetchedAt: Date.now() };
    return products;
  } catch {
    return productsCache?.value ?? null;
  }
}

function mergeProducts(base: Corpus, products: Doc[] | null): Corpus {
  if (!products?.length) return base;

  const docs = [
    ...base.docs.filter((d) => d.kind !== "product"),
    ...products,
  ];

  return {
    generatedAt: base.generatedAt,
    docs,
  };
}

export async function getCorpusState(): Promise<{
  index: SearchIndex;
  generatedAt: string;
  source: "blob" | "seed";
  productsLive: boolean;
}> {
  const hit = fresh(indexCache, Math.min(CORPUS_TTL_MS, PRODUCTS_TTL_MS));
  if (hit) return hit;

  const { corpus: base, source } = await loadBaseCorpus();
  const products = await loadLiveProducts();
  const merged = mergeProducts(base, products);
  const index = new SearchIndex(merged.docs);

  const value = {
    index,
    generatedAt: base.generatedAt,
    source,
    productsLive: Boolean(products?.length),
  };

  indexCache = { value, fetchedAt: Date.now() };
  return value;
}

/** Drop caches after a successful cron refresh in this isolate. */
export function invalidateCorpusCache(): void {
  baseCache = null;
  productsCache = null;
  indexCache = null;
}

export function withRef(url: string): string {
  return url.includes("?") ? `${url}&${REF}` : `${url}?${REF}`;
}

/** Compact result line. Full text comes from get_recipe, so keep this tight. */
export function formatHit(doc: Doc): string {
  const lines = [doc.title, doc.summary, withRef(doc.url), `id: ${doc.id}`];
  return lines.filter(Boolean).join("\n");
}

export function formatProduct(doc: Doc): string {
  const p = doc.product;
  if (!p) return formatHit(doc);

  const price = p.priceMin === p.priceMax
    ? `$${p.priceMin}`
    : `$${p.priceMin}–$${p.priceMax}`;

  const variants = p.variants
    .map((v) => `  ${v.title} — $${v.price}${v.available ? "" : " (sold out)"} — variantId: ${v.id}`)
    .join("\n");

  return [
    doc.title,
    price + (p.available ? "" : " — currently unavailable"),
    doc.summary,
    withRef(doc.url),
    p.variants.length > 1 || p.variants[0]?.title !== "Default Title"
      ? `variants:\n${variants}`
      : `variantId: ${p.variants[0]?.id}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Prior docs for cron merge (Blob if present, else seed). */
export async function getPriorDocsForRefresh(): Promise<Doc[]> {
  const { corpus } = await loadBaseCorpus();
  return corpus.docs;
}
