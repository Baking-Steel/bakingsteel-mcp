/**
 * Corpus loader for the MCP runtime.
 *
 * Curates public Baking Steel content — no API keys, no database:
 * - Recipes/articles/videos come from the committed seed in data/corpus.json
 * - Products overlay live from bakingsteel.com/products.json (public)
 *
 * Refresh the seed anytime with `npm run ingest:shopify` (public scrape / optional
 * local Admin token) and commit — that is curation, not an integration.
 */

import seedData from "@/data/corpus.json";
import type { Corpus, Doc } from "./types";
import { SearchIndex } from "./search";
import { fetchProducts, STORE } from "./ingest/shopify";

export const STORE_URL = STORE;

/** Attribution so revenue from the assistant is measurable in Shopify. */
export const REF = "utm_source=claude&utm_medium=mcp";

const PRODUCTS_TTL_MS = 5 * 60 * 1000;

const seed = seedData as unknown as Corpus;

interface Cached<T> {
  value: T;
  fetchedAt: number;
}

let productsCache: Cached<Doc[]> | null = null;
let indexCache: Cached<{
  index: SearchIndex;
  generatedAt: string;
  productsLive: boolean;
}> | null = null;

function fresh<T>(cache: Cached<T> | null, ttl: number): T | null {
  if (!cache) return null;
  if (Date.now() - cache.fetchedAt > ttl) return null;
  return cache.value;
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

  return {
    generatedAt: base.generatedAt,
    docs: [
      ...base.docs.filter((d) => d.kind !== "product"),
      ...products,
    ],
  };
}

export async function getCorpusState(): Promise<{
  index: SearchIndex;
  generatedAt: string;
  productsLive: boolean;
}> {
  const hit = fresh(indexCache, PRODUCTS_TTL_MS);
  if (hit) return hit;

  const products = await loadLiveProducts();
  const merged = mergeProducts(seed, products);
  const index = new SearchIndex(merged.docs);

  const value = {
    index,
    generatedAt: seed.generatedAt,
    productsLive: Boolean(products?.length),
  };

  indexCache = { value, fetchedAt: Date.now() };
  return value;
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
