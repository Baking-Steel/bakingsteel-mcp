/**
 * Ranking check. Each query lists its expected top result, so regressions in
 * scoring show up as a wrong first line rather than silently degrading search.
 *
 *   npm run eval:search
 */

import { SearchIndex } from '../lib/search';
import corpus from '../data/corpus.json';

const index = new SearchIndex(corpus.docs as never);
const queries = [
  '72 hour cold ferment dough',
  'my dough keeps tearing when I stretch it',
  'smash burger on the griddle',
  'how do I clean and season my steel',
  'gluten free pizza dough',
];
for (const q of queries) {
  console.log(`\nQ: ${q}`);
  for (const h of index.search(q, { kinds: ['recipe', 'article', 'video'], limit: 3 })) {
    console.log(`   ${h.score.toFixed(2).padStart(6)}  ${h.doc.title}`);
  }
}
