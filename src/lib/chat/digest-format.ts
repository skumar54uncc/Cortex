/** Second-person digest copy for the Digest tab (post-LLM normalize). */
export function personalizeDigestNarrative(raw: string): string {
  let s = raw.trim().replace(/\s+/g, " ");
  if (!s) return "Your reading activity will appear here once Cortex has indexed pages.";

  if (/^the user(?:'s)?\s+/i.test(s)) {
    s = s.replace(/^the user's\s+/i, "Your ");
    s = s.replace(/^the user\s+/i, "You ");
  }

  if (/^their\s+/i.test(s)) {
    s = s.replace(/^their\s+/i, "Your ");
  }

  if (!/^your\b/i.test(s) && !/^you\b/i.test(s)) {
    const lower = s.charAt(0).toLowerCase() + s.slice(1);
    s = `Your recent reading focused on ${lower}`;
  }

  return s;
}

/**
 * Models sprinkle markdown even when told not to. Drop the decoration and
 * keep the words: bold, italics, inline code, links, list bullets, headings.
 * Never throws; a string always comes back.
 */
export function stripDigestMarkdown(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\][]+)\]\((https?:[^)]*)\)/gi, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1$2")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*/g, "")
    .trim();
}

/** Page-derived text: trimmed and capped, never HTML-escaped (rendered as textContent). */
export function cleanSourceTitle(raw: string, maxChars = 160): string {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars).replace(/\s\S*$/, "")}…`;
}

export interface CitationExtraction {
  /** The sentence with every citation marker removed and spacing repaired. */
  text: string;
  /** In-range source numbers, ascending and deduped. */
  indexes: number[];
  /** True when the text carried at least one marker, valid or not. */
  hadMarker: boolean;
}

/**
 * Pull [1], [2][3] and [1, 2] style markers out of one line of model output.
 * Out-of-range and non-numeric markers are dropped, not thrown on.
 */
export function extractCitationIndexes(
  raw: string,
  maxIndex: number
): CitationExtraction {
  const text = raw ?? "";
  const seen = new Set<number>();
  let hadMarker = false;

  const stripped = text.replace(/\[([^\]]{0,40})\]/g, (whole, inner: string) => {
    const body = inner.trim();
    if (!/^\d{1,3}(\s*[,;/]\s*\d{1,3})*$/.test(body)) {
      // Not a citation marker (for example "[abc]"): leave numerics out but
      // still drop bracket noise the model invented around numbers.
      return /^\d+$/.test(body) ? "" : whole;
    }
    hadMarker = true;
    for (const part of body.split(/[,;/]/)) {
      const n = Number.parseInt(part.trim(), 10);
      if (Number.isFinite(n) && n >= 1 && n <= maxIndex) seen.add(n);
    }
    return "";
  });

  const cleaned = stripped
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    text: cleaned,
    indexes: [...seen].sort((a, b) => a - b),
    hadMarker,
  };
}

/**
 * Split a narrative paragraph into sentences for per-sentence citations.
 * Abbreviation-safe enough for digest copy and never returns empty strings.
 */
export function splitNarrativeSentences(raw: string): string[] {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (!s) return [];
  const parts = s
    .split(/(?<=[.!?])["')\]]?\s+(?=[A-Z0-9"'(])/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : [s];
}
