/**
 * Shopify article bodies arrive as theme HTML. We keep the structure that
 * carries meaning for a recipe — headings, list items, paragraph breaks — and
 * discard everything else.
 */

const BLOCK_CLOSE = /<\/(p|div|section|article|h[1-6]|ul|ol|table|tr|blockquote)>/gi;

export function htmlToText(html: string): string {
  if (!html) return "";

  return (
    html
      // Drop anything that never renders as prose.
      .replace(/<(script|style|noscript|iframe|svg)[\s\S]*?<\/\1>/gi, " ")
      // Preserve list structure — ingredient lists live here.
      .replace(/<li[^>]*>/gi, "\n- ")
      // Headings become their own line so section names survive.
      .replace(/<h([1-6])[^>]*>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(BLOCK_CLOSE, "\n\n")
      .replace(/<[^>]+>/g, "")
      // Entities, most-specific first so &amp;nbsp; can't double-decode.
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      // Collapse the whitespace the tag stripping left behind.
      .replace(/[ \t ]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** First couple of sentences, for search result previews. */
export function summarize(text: string, maxLen = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;

  const cut = flat.slice(0, maxLen);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return lastStop > 80 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`;
}
