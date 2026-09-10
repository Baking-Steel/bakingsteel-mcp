import { NextRequest, NextResponse } from "next/server";
import { refreshCorpusFromPublicWeb } from "@/lib/ingest/refresh";
import { writeCorpusToBlob } from "@/lib/blob-corpus";
import {
  getPriorDocsForRefresh,
  invalidateCorpusCache,
} from "@/lib/corpus";

export const runtime = "nodejs";
/** Pro/Enterprise allow up to 300s; scrape stops itself at ~240s. */
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Weekly public scrape. No Shopify Admin token.
 * Needs BLOB_READ_WRITE_TOKEN (save JSON) + CRON_SECRET (auth).
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN is not configured" },
      { status: 503 },
    );
  }

  try {
    const prior = await getPriorDocsForRefresh();
    const result = await refreshCorpusFromPublicWeb(prior);
    const url = await writeCorpusToBlob(result.corpus);
    invalidateCorpusCache();

    return NextResponse.json({
      ok: true,
      generatedAt: result.corpus.generatedAt,
      docs: result.corpus.docs.length,
      products: result.products,
      recipes: result.recipes,
      articles: result.articles,
      videos: result.videos,
      sitemapUrls: result.sitemapUrls,
      scrape: {
        attempted: result.scrape.attempted,
        scraped: result.scrape.scraped.length,
        failed: result.scrape.failed,
        remaining: result.scrape.remaining,
      },
      blobUrl: url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("weekly refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
