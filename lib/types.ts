/**
 * The corpus is a single JSON file committed to the repo. At this scale
 * (~800 docs, ~1MB) it loads into memory on cold start and needs no database.
 */

export type DocKind = "recipe" | "article" | "video" | "product";

export type Steel =
  | "original"
  | "plus"
  | "pro"
  | "griddle"
  | "kamado"
  | "mini";

export type Difficulty = "easy" | "medium" | "advanced";

export interface RecipeFields {
  ingredients: string[];
  steps: string[];
  ovenTempF?: number;
  preheatMin?: number;
  totalTimeMin?: number;
  /** Which Baking Steel products this recipe is written for. */
  steel?: Steel[];
  difficulty?: Difficulty;
  /** e.g. "72-hour cold ferment" — the thing that makes this recipe distinct. */
  technique?: string;
}

export interface ProductVariant {
  id: number;
  title: string;
  price: number;
  available: boolean;
}

export interface ProductFields {
  handle: string;
  productType: string;
  priceMin: number;
  priceMax: number;
  available: boolean;
  variants: ProductVariant[];
  imageUrl?: string;
}

export interface VideoFields {
  videoId: string;
  durationSec?: number;
  /** Deep links back to the moment in the video a step is described. */
  chapters?: { label: string; startSec: number }[];
}

export interface Doc {
  /** Stable, namespaced: "blog:72-hour-pizza-dough", "product:baking-steel-pro". */
  id: string;
  kind: DocKind;
  title: string;
  url: string;
  /** One or two sentences. Shown in search results. */
  summary: string;
  /** Plain text, searchable. Source of truth for retrieval. */
  body: string;
  tags: string[];
  publishedAt?: string;
  recipe?: RecipeFields;
  product?: ProductFields;
  video?: VideoFields;
}

export interface Corpus {
  generatedAt: string;
  docs: Doc[];
}
