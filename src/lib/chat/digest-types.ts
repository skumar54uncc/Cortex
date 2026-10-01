export type DigestRange = "today" | "yesterday" | "last_7_days";

export interface DigestRequest {
  range: DigestRange;
  forceRegenerate?: boolean;
}

/**
 * Bumped whenever the DigestResult shape changes in a way the UI can see.
 * The digest cache keys on it, so a digest written by an older build is
 * never handed to a newer renderer (see digest-cache.ts).
 * 1 = release 1.2.0 narrative only. 2 = numbered, citable sources.
 * 3 = reading focus must be a finished paragraph, so a cutoff digest is not reused.
 */
export const DIGEST_SCHEMA_VERSION = 3;

/**
 * One numbered, clickable source. `n` is the number the model saw as [N] in
 * the prompt and the number every sourceIndexes entry in this result refers
 * to. Numbers are contiguous from 1 and stable inside one DigestResult.
 *
 * `url` has already passed safeHttpHttpsHref, so it is safe to put straight
 * into an anchor href. `title` is page-derived text: it is trimmed and capped
 * but NOT HTML-escaped, so render it with textContent, never innerHTML.
 */
export interface DigestSource {
  n: number;
  url: string;
  title: string;
  domain: string;
  visitedAt: number;
}

/**
 * One sentence of the narrative plus the sources behind it. `text` has no
 * [N] markers left in it; render the sentence, then render one numbered chip
 * per entry of sourceIndexes, looking each number up in `sources` by `n`.
 * sourceIndexes is ascending, deduped, and every number resolves to a source.
 * It can be empty when the model cited nothing for that sentence and other
 * sentences did carry citations.
 */
export interface DigestNarrativePart {
  text: string;
  sourceIndexes: number[];
}

/**
 * Per-site roll-up, busiest site first. Lets the UI show "linkedin.com (3)"
 * with chips for the example sources behind that count.
 */
export interface DigestDomainGroup {
  domain: string;
  count: number;
  /** Up to 6 example source numbers from this domain, ascending. */
  sourceIndexes: number[];
}

/**
 * A notable finding. sourceUrl / sourceTitle are kept for existing callers;
 * sourceIndexes is the same source expressed as numbers into `sources`.
 */
export interface DigestInsight {
  text: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceIndexes: number[];
}

/**
 * Digest payload for the Digest tab.
 *
 * Rendering contract for the overlay:
 * - `narrative` is the full paragraph as plain prose, with every [N] marker
 *   already stripped. Use it as a fallback or for copy-to-clipboard.
 * - `narrativeParts` is the same paragraph split per sentence, each carrying
 *   the source numbers behind it, so the sentence can be followed by numbered
 *   chips that link to sources[n - 1] (or look up by `n`).
 * - `sources[i].url` is already sanitized; `title` must be rendered as text.
 * - `domainGroups` gives per-site counts for copy such as
 *   "On linkedin.com you read 3 profiles [1][2][3]".
 * - `citationsFromModel` is false when the model emitted no usable [N] and
 *   the top sources by importance were attached instead. The UI can render
 *   the chips exactly the same way; the flag is for diagnostics and eval.
 */
export interface DigestResult {
  schemaVersion: number;
  range: string;
  generatedAt: number;
  pageCount: number;
  domainsCount: number;
  narrative: string;
  narrativeParts: DigestNarrativePart[];
  topics: Array<{ topic: string; pageCount: number }>;
  insights: DigestInsight[];
  sources: DigestSource[];
  domainGroups: DigestDomainGroup[];
  citationsFromModel: boolean;
}
