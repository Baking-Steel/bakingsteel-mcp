/**
 * Persist the weekly scrape to Vercel Blob — a JSON file only.
 * Not a database and not a Shopify integration.
 */

import { put, list } from "@vercel/blob";
import type { Corpus } from "./types";

export const CORPUS_BLOB_PATHNAME = "corpus.json";

export async function readCorpusFromBlob(): Promise<Corpus | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;

  try {
    const { blobs } = await list({
      prefix: CORPUS_BLOB_PATHNAME,
      limit: 10,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    const match =
      blobs.find((b) => b.pathname === CORPUS_BLOB_PATHNAME) ?? blobs[0];
    if (!match?.url) return null;

    const res = await fetch(match.url, { cache: "no-store" });
    if (!res.ok) return null;

    return (await res.json()) as Corpus;
  } catch {
    return null;
  }
}

export async function writeCorpusToBlob(corpus: Corpus): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set");

  const blob = await put(CORPUS_BLOB_PATHNAME, JSON.stringify(corpus), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });

  return blob.url;
}
