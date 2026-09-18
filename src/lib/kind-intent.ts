/**
 * Query intent for chunk kinds (Phase 5). Words like "video", "table" or
 * "pdf" boost chunks of that kind. Queries without intent words get no boost
 * at all, so plain searches rank exactly as before.
 */
import type { ChunkKind } from "../db/schema";

export interface KindIntent {
  kinds: ChunkKind[];
  /** "person", "people", "profile": prefer LinkedIn people and profiles. */
  person: boolean;
}

const RULES: Array<[RegExp, ChunkKind]> = [
  [/\b(videos?|watched|youtube|transcripts?|clips?)\b/i, "transcript"],
  [/\b(tables?|charts?|spreadsheets?)\b/i, "table"],
  [/\b(images?|photos?|pictures?|figures?|diagrams?|screenshots?)\b/i, "image"],
  [/\bpdfs?\b/i, "pdf"],
  [/\b(highlights?|highlighted|my notes|saved quotes?)\b/i, "highlight"],
];

const PERSON_RE = /\b(person|people|profiles?|who)\b/i;

export const KIND_INTENT_BOOST = 1.25;

export function detectKindIntent(query: string): KindIntent {
  const q = String(query ?? "");
  const kinds: ChunkKind[] = [];
  for (const [re, kind] of RULES) {
    if (re.test(q) && !kinds.includes(kind)) kinds.push(kind);
  }
  return { kinds, person: PERSON_RE.test(q) };
}

export function kindBoost(kind: ChunkKind, intent: KindIntent): number {
  return intent.kinds.includes(kind) ? KIND_INTENT_BOOST : 1;
}
