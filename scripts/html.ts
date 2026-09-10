/**
 * Re-export HTML helpers so existing `scripts/html` imports keep working.
 * Prefer `@/lib/html` in new code.
 */

export { htmlToText, summarize } from "../lib/html";
