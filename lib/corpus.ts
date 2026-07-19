/**
 * The corpus ships as a bundled JSON import rather than a runtime file read, so
 * serverless cold starts have no filesystem or network dependency. The index is
 * built once per instance and reused across requests.
 */

import corpusData from "@/data/corpus.json";
import type { Corpus, Doc } from "./types";
import { SearchIndex } from "./search";

const corpus = corpusData as unknown as Corpus;

export const index = new SearchIndex(corpus.docs);
export const generatedAt = corpus.generatedAt;

export const STORE_URL = "https://bakingsteel.com";

/** Attribution so revenue from the assistant is measurable in Shopify. */
export const REF = "utm_source=claude&utm_medium=mcp";

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
