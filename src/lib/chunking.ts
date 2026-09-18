/** Chunk readable web text for stronger retrieval than single-page embeddings */

export interface ChunkProfile {
  targetWords: number;
  overlapWords: number;
  /** Per-page cap; sized so both profiles cover about 12,500 words. */
  maxChunks: number;
}

/**
 * Two candidate profiles compared in Phase 3.2 on nDCG@10 and Recall@10.
 * `wide` is the 1.0.x behaviour. The winner is DEFAULT_CHUNK_PROFILE and is
 * recorded on documents as `chunkingVersion` so old pages can be re-chunked.
 */
export const CHUNK_PROFILES = {
  compact: { targetWords: 180, overlapWords: 40, maxChunks: 88 },
  wide: { targetWords: 420, overlapWords: 75, maxChunks: 36 },
} as const satisfies Record<string, ChunkProfile>;

export type ChunkProfileName = keyof typeof CHUNK_PROFILES;

/**
 * Bumped whenever the default profile or the window rule changes.
 * 1 = 420/75 (1.0.x), 2 = 180/40 (Phase 3.2 winner on nDCG@10, Recall@10 tie).
 */
export const CHUNKING_VERSION = 2;
export const DEFAULT_CHUNK_PROFILE: ChunkProfileName = "compact";

function wordsOf(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
}

export interface TextChunk {
  text: string;
  ord: number;
}

/**
 * Sliding windows of `targetWords` with `overlapWords` overlap.
 */
export function chunkArticle(
  fullText: string,
  profile: ChunkProfile = CHUNK_PROFILES[DEFAULT_CHUNK_PROFILE]
): TextChunk[] {
  const words = wordsOf(fullText);
  if (words.length === 0) return [];

  const target = Math.max(1, Math.floor(profile.targetWords));
  const step = Math.max(1, target - Math.max(0, Math.floor(profile.overlapWords)));

  const out: TextChunk[] = [];
  let start = 0;
  let ord = 0;

  const maxChunks = Math.max(1, Math.floor(profile.maxChunks));
  while (start < words.length && out.length < maxChunks) {
    const end = Math.min(start + target, words.length);
    const slice = words.slice(start, end).join(" ").trim();
    if (slice.length > 40) {
      out.push({ text: slice, ord });
      ord += 1;
    }
    if (end >= words.length) break;
    start += step;
  }

  return out.length ? out : [{ text: fullText.slice(0, 8000).trim(), ord: 0 }];
}

/**
 * Inverse of chunkArticle for stored chunks: drops the overlapping words at
 * each boundary when they line up, otherwise falls back to a plain join.
 * Used by the background re-chunk job (Phase 3.4); exact for pages that did
 * not hit the per-page chunk cap.
 */
export function reconstructTextFromChunks(
  chunks: { ord: number; text: string }[],
  profile: ChunkProfile
): string {
  const sorted = [...chunks].sort((a, b) => a.ord - b.ord);
  if (sorted.length === 0) return "";
  const overlap = Math.max(0, Math.floor(profile.overlapWords));
  let words = wordsOf(sorted[0]!.text);
  for (let i = 1; i < sorted.length; i++) {
    const next = wordsOf(sorted[i]!.text);
    const tail = words.slice(-overlap);
    const head = next.slice(0, overlap);
    const aligned =
      overlap > 0 &&
      tail.length === overlap &&
      head.length === overlap &&
      tail.every((w, k) => w === head[k]);
    words = aligned ? words.concat(next.slice(overlap)) : words.concat(next);
  }
  return words.join(" ");
}
