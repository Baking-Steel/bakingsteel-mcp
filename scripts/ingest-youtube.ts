/**
 * Pulls the Baking Steel channel's videos and transcripts into the corpus.
 *
 * Uses yt-dlp rather than the YouTube Data API. The API can enumerate a channel
 * cheaply, but captions.download costs 200 quota units per video against a
 * 10,000/day default and additionally requires channel-owner OAuth — roughly a
 * week of ingest and a credential dance, for text yt-dlp fetches directly.
 *
 * Transcripts are auto-generated (ASR). That is a feature here: we want how
 * Andris actually speaks, which ASR preserves better than polished subtitles.
 *
 *   npm run ingest:youtube
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Doc } from "../lib/types";
import { summarize } from "./html";

const execFileAsync = promisify(execFile);

const CHANNEL = "https://www.youtube.com/channel/UCpG81Xa-wHu8P7s_RjzBaBg/videos";
const CACHE_DIR = join(process.cwd(), ".cache", "transcripts");
const CORPUS_PATH = join(process.cwd(), "data", "corpus.json");

/** yt-dlp is already pacing itself; this is politeness on top. */
const DELAY_MS = 750;

/**
 * YouTube changed ASR models partway through this channel's history. Newer
 * videos come back punctuated and accurate; older ones are unpunctuated
 * run-ons with severe errors — "baby seal test kitchen" for "Baking Steel Test
 * Kitchen", "a beautiful cleaning Rick" for "cleaning brick". Roughly two
 * thirds of the channel predates the change.
 *
 * Presence of sentence punctuation cleanly separates the two eras. The blog
 * already covers this material across 285 recipes, so dropping the garbled
 * transcripts costs little coverage and avoids attributing nonsense to Andris.
 */
const MIN_SENTENCE_MARKS_PER_100_WORDS = 2;
const MIN_WORDS = 50;

function transcriptQuality(text: string): { words: number; marksPer100: number } {
  const words = text.split(/\s+/).filter(Boolean).length;
  const marks = (text.match(/[.!?]/g) ?? []).length;
  return { words, marksPer100: words ? (marks / words) * 100 : 0 };
}

function isUsable(text: string): boolean {
  const { words, marksPer100 } = transcriptQuality(text);
  return words >= MIN_WORDS && marksPer100 >= MIN_SENTENCE_MARKS_PER_100_WORDS;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Video {
  id: string;
  title: string;
}

async function listVideos(): Promise<Video[]> {
  const { stdout } = await execFileAsync(
    "yt-dlp",
    ["--flat-playlist", "--print", "%(id)s\t%(title)s", CHANNEL],
    { maxBuffer: 32 * 1024 * 1024 },
  );

  return stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([id, title]) => id && title)
    .map(([id, title]) => ({ id, title: title.trim() }));
}

interface Json3 {
  events?: { segs?: { utf8?: string }[] }[];
}

/** json3 splits speech into timed segments; join them back into prose. */
function transcriptText(raw: string): string {
  const parsed = JSON.parse(raw) as Json3;
  return (parsed.events ?? [])
    .filter((e) => e.segs)
    .map((e) => (e.segs ?? []).map((s) => s.utf8 ?? "").join(""))
    .join("")
    .replace(/\n/g, " ")
    // Strip the bracketed non-speech cues ASR inserts: [music], [applause].
    .replace(/\[[a-z ]{2,20}\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchTranscript(videoId: string): Promise<string | null> {
  const cachePath = join(CACHE_DIR, `${videoId}.txt`);
  try {
    return await readFile(cachePath, "utf8");
  } catch {
    // Not cached yet.
  }

  const work = join(tmpdir(), `bs-sub-${videoId}`);
  await mkdir(work, { recursive: true });

  try {
    await execFileAsync("yt-dlp", [
      "--skip-download",
      "--write-auto-subs",
      "--sub-langs",
      "en-orig,en",
      "--sub-format",
      "json3",
      "-o",
      join(work, "sub"),
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);

    const files = await readdir(work);
    // en-orig is the original spoken track; en may be a translation of it.
    const chosen =
      files.find((f) => f.includes("en-orig")) ?? files.find((f) => f.endsWith(".json3"));
    if (!chosen) return null;

    const text = transcriptText(await readFile(join(work, chosen), "utf8"));
    if (!text) return null;

    await writeFile(cachePath, text);
    return text;
  } catch {
    return null;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main() {
  console.log("Ingesting Baking Steel YouTube...\n");
  await mkdir(CACHE_DIR, { recursive: true });

  const videos = await listVideos();
  console.log(`  ${videos.length} videos on channel\n`);

  const docs: Doc[] = [];
  let missing = 0;
  const rejected: string[] = [];

  for (const [i, video] of videos.entries()) {
    const text = await fetchTranscript(video.id);
    if (!text) {
      missing++;
      continue;
    }

    if (!isUsable(text)) {
      rejected.push(video.title);
      continue;
    }

    docs.push({
      id: `video:${video.id}`,
      kind: "video",
      title: video.title,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      summary: summarize(text),
      body: text,
      tags: ["video"],
      video: { videoId: video.id },
    });

    if ((i + 1) % 10 === 0) console.log(`  ...${i + 1}/${videos.length}`);
    await sleep(DELAY_MS);
  }

  // Merge into the corpus alongside the Shopify content.
  const existing = new Map<string, Doc>();
  try {
    const prior = JSON.parse(await readFile(CORPUS_PATH, "utf8")) as { docs: Doc[] };
    for (const doc of prior.docs) existing.set(doc.id, doc);
  } catch {
    // No corpus yet.
  }

  // This script owns every video: doc, so a transcript that no longer passes
  // the quality gate is removed rather than left behind from an earlier run.
  for (const id of [...existing.keys()]) {
    if (id.startsWith("video:")) existing.delete(id);
  }
  for (const doc of docs) existing.set(doc.id, doc);

  await mkdir(join(process.cwd(), "data"), { recursive: true });
  await writeFile(
    CORPUS_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), docs: [...existing.values()] }, null, 2),
  );

  console.log(`\n  ${docs.length} usable transcripts`);
  if (missing) console.log(`  ${missing} videos have no captions at all`);
  if (rejected.length) {
    console.log(`  ${rejected.length} dropped as pre-punctuation ASR, for example:`);
    for (const title of rejected.slice(0, 3)) console.log(`    ${title}`);
  }
  console.log(`  corpus now ${existing.size} docs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
