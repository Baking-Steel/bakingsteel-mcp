import { NextRequest, NextResponse } from "next/server";
import { buildCorpusFromShopify } from "@/lib/ingest/build-corpus";
import { writeCorpusToBlob } from "@/lib/blob-corpus";
import {
  getPriorDocsForRefresh,
  invalidateCorpusCache,
} from "@/lib/corpus";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

/**
 * Vercel Cron (and manual ops) refresh recipes/articles into Blob.
 * Products are also refreshed here; the MCP overlays products.json live too.
 *
 * Secrets: SHOPIFY_ADMIN_TOKEN, BLOB_READ_WRITE_TOKEN, CRON_SECRET — Vercel only.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminToken = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!adminToken) {
    return NextResponse.json(
      { error: "SHOPIFY_ADMIN_TOKEN is not configured on this deployment" },
      { status: 503 },
    );
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN is not configured on this deployment" },
      { status: 503 },
    );
  }

  try {
    const prior = await getPriorDocsForRefresh();
    const built = await buildCorpusFromShopify(prior, adminToken);
    const url = await writeCorpusToBlob(built.corpus);
    invalidateCorpusCache();

    return NextResponse.json({
      ok: true,
      generatedAt: built.corpus.generatedAt,
      docs: built.corpus.docs.length,
      products: built.products,
      recipes: built.recipes,
      articles: built.articles,
      videos: built.videos,
      preserved: built.preserved,
      blobUrl: url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("corpus refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
