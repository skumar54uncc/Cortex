/** Chunk readable web text for stronger retrieval than single-page embeddings */

const TARGET_WORDS = 420;
const OVERLAP_WORDS = 75;
const MAX_CHUNKS_PER_PAGE = 36;

function wordsOf(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
}

export interface TextChunk {
  text: string;
  ord: number;
}

/**
 * Sliding windows ~420 words with ~75 word overlap (production-style overlap).
 */
export function chunkArticle(fullText: string): TextChunk[] {
  const words = wordsOf(fullText);
  if (words.length === 0) return [];

  const out: TextChunk[] = [];
  let start = 0;
  let ord = 0;

  while (start < words.length && out.length < MAX_CHUNKS_PER_PAGE) {
    const end = Math.min(start + TARGET_WORDS, words.length);
    const slice = words.slice(start, end).join(" ").trim();
    if (slice.length > 40) {
      out.push({ text: slice, ord });
      ord += 1;
    }
    if (end >= words.length) break;
    start += Math.max(1, TARGET_WORDS - OVERLAP_WORDS);
  }

  return out.length ? out : [{ text: fullText.slice(0, 8000).trim(), ord: 0 }];
}
