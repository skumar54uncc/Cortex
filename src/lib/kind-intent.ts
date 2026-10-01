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

/** Text the user explicitly saved ranks slightly above the same text on a page. */
export const HIGHLIGHT_BOOST = 1.15;

/**
 * Person intent. On the pinned eval corpus a LinkedIn profile scores about
 * 0.46 while a same-cluster article scores about 0.83 and a news page that
 * says "employs N people" scores about 1.0. 2.4 lifts the profile over the
 * article. 0.4 drops the headcount page under it. Queries with no person
 * intent are unchanged.
 */
export const PERSON_PROFILE_BOOST = 2.4;
export const EMPLOYMENT_HEADCOUNT_DEMOTE = 0.4;

const EMPLOYS_PEOPLE_RE = /\bemploys?\s+\d[\d,]*\s+people\b/i;

export function isPersonProfileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return false;
    return /^\/in\/[^/?#]+/i.test(u.pathname);
  } catch {
    return false;
  }
}

export function textHasEmploymentHeadcount(text: string): boolean {
  return EMPLOYS_PEOPLE_RE.test(text);
}

export function personScoreMultiplier(
  personIntent: boolean,
  url: string,
  employmentHeadcount: boolean
): number {
  if (!personIntent) return 1;
  if (isPersonProfileUrl(url)) return PERSON_PROFILE_BOOST;
  if (employmentHeadcount) return EMPLOYMENT_HEADCOUNT_DEMOTE;
  return 1;
}

export function detectKindIntent(query: string): KindIntent {
  const q = String(query ?? "");
  const kinds: ChunkKind[] = [];
  for (const [re, kind] of RULES) {
    if (re.test(q) && !kinds.includes(kind)) kinds.push(kind);
  }
  return { kinds, person: PERSON_RE.test(q) };
}

export function kindBoost(kind: ChunkKind, intent: KindIntent): number {
  const base = kind === "highlight" ? HIGHLIGHT_BOOST : 1;
  return intent.kinds.includes(kind) ? base * KIND_INTENT_BOOST : base;
}
