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

/** Site chrome rather than a page you chose to read. */
const CHROME_TITLES =
  /^(feed|home|notifications?|messages?|messaging|my network|jobs|search|inbox|dashboard|explore|for you|shorts|subscriptions|watch later|history|settings|profile|linkedin|youtube|instagram|facebook|x|twitter)$/i;

const SITE_SUFFIX = /\s*[-|\u00b7\u2014\u2013]\s*(youtube|linkedin|instagram|facebook|x|twitter|google search|google maps|amazon\.[a-z.]+|github)\s*$/i;

/**
 * A page title as a person would say it: no unread counter, no site name
 * tacked on the end, short enough to read in a list.
 */
export function pageLabel(raw: string, maxChars = 60): string {
  let t = (raw || "").replace(/\s+/g, " ").trim();
  t = t.replace(/^\(\d+\)\s*/, "");
  t = t.replace(SITE_SUFFIX, "").trim();
  if (!t) return "Untitled";
  return t.length <= maxChars ? t : `${t.slice(0, maxChars).replace(/\s\S*$/, "")}…`;
}

export interface LabelledPage {
  label: string;
  url: string;
  title: string;
}

/**
 * The pages to name for one site: each one once (the same video watched three
 * times is one line), real pages before the site's own chrome.
 */
export function pickSitePages<T extends { title: string; url: string }>(pages: T[], limit: number): LabelledPage[] {
  const seen = new Set<string>();
  const real: LabelledPage[] = [];
  const chrome: LabelledPage[] = [];
  for (const p of pages) {
    const label = pageLabel(p.title);
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    (CHROME_TITLES.test(label) ? chrome : real).push({ label, url: p.url, title: p.title });
  }
  return (real.length ? real : chrome).slice(0, limit);
}

/**
 * Models get cut off mid sentence. Show what they finished saying, unless
 * that would leave nothing at all.
 */
export function completeSentencesOnly(raw: string): string {
  const text = (raw || "").trim();
  if (!text) return "";
  // A real sentence end is followed by a capital or nothing at all, so the
  // dot in "github.com you explored" does not count.
  let lastStop = -1;
  const boundary = /[.!?](?=\s+["'(“]?[A-Z]|\s*$)/g;
  for (let m = boundary.exec(text); m; m = boundary.exec(text)) lastStop = m.index;
  if (lastStop === -1) return text;
  const trimmed = text.slice(0, lastStop + 1).trim();
  return trimmed || text;
}
