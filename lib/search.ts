/**
 * BM25 over the in-memory corpus.
 *
 * ~300 documents is small enough that a full scan per query costs well under a
 * millisecond, so there is no index to persist and no vector store to operate.
 * The MCP client is itself a capable model — it reformulates and re-queries when
 * results miss, which covers most of what semantic search would buy us here.
 */

import type { Doc, DocKind } from "./types";

const K1 = 1.5;
const B = 0.75;

/** Title terms matter more than body terms; repeating them applies the weight. */
const TITLE_WEIGHT = 3;

/**
 * Repeating title tokens alone is not enough: in a corpus where nearly every
 * recipe says "hour" and "dough", those terms carry almost no IDF, so a long
 * article can outrank the recipe whose title is a near-exact match. This adds a
 * bonus proportional to how much of the query the title actually covers.
 */
const TITLE_COVERAGE_BONUS = 6;

/** Common enough in this corpus to carry no signal. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "how",
  "i", "in", "is", "it", "my", "of", "on", "or", "that", "the", "this", "to",
  "was", "what", "when", "why", "with", "you", "your",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%°\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface IndexedDoc {
  doc: Doc;
  termFreq: Map<string, number>;
  titleTerms: Set<string>;
  length: number;
}

export interface SearchOptions {
  kinds?: DocKind[];
  limit?: number;
}

export interface SearchHit {
  doc: Doc;
  score: number;
}

export class SearchIndex {
  private readonly docs: IndexedDoc[];
  private readonly docFreq = new Map<string, number>();
  private readonly avgLength: number;

  constructor(docs: Doc[]) {
    this.docs = docs.map((doc) => {
      const tokens = [
        ...Array<string>(TITLE_WEIGHT).fill(doc.title).flatMap(tokenize),
        ...tokenize(doc.summary),
        ...tokenize(doc.tags.join(" ")),
        ...tokenize(doc.body),
      ];

      const termFreq = new Map<string, number>();
      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
      }
      for (const term of termFreq.keys()) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      }

      return {
        doc,
        termFreq,
        titleTerms: new Set(tokenize(doc.title)),
        length: tokens.length,
      };
    });

    const total = this.docs.reduce((sum, d) => sum + d.length, 0);
    this.avgLength = this.docs.length ? total / this.docs.length : 0;
  }

  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.docFreq.get(term) ?? 0;
    // Standard BM25 IDF, floored so saturated terms never score negative.
    return Math.max(0, Math.log(1 + (n - df + 0.5) / (df + 0.5)));
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const { kinds, limit = 8 } = options;
    const hits: SearchHit[] = [];

    for (const entry of this.docs) {
      if (kinds && !kinds.includes(entry.doc.kind)) continue;

      let score = 0;
      for (const term of terms) {
        const tf = entry.termFreq.get(term);
        if (!tf) continue;

        const norm = 1 - B + B * (entry.length / (this.avgLength || 1));
        score += this.idf(term) * ((tf * (K1 + 1)) / (tf + K1 * norm));
      }

      if (score <= 0) continue;

      const covered = terms.filter((t) => entry.titleTerms.has(t)).length;
      score += TITLE_COVERAGE_BONUS * (covered / terms.length);

      hits.push({ doc: entry.doc, score });
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  get(id: string): Doc | undefined {
    return this.docs.find((d) => d.doc.id === id)?.doc;
  }

  all(kind?: DocKind): Doc[] {
    const docs = this.docs.map((d) => d.doc);
    return kind ? docs.filter((d) => d.kind === kind) : docs;
  }
}
