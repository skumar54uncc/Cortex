/** Lightweight NL hints — extractive, no remote LLM */

export interface ParsedAskQuery {
  /** Full text for embedding */
  embeddingText: string;
  /** Boost lexical match if these appear in indexed text */
  entityTerms: string[];
  timeRange?: { start: number; end: number };
  /** Profile / people-style question */
  preferLinkedIn: boolean;
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "someone",
  "somebody",
  "anyone",
  "person",
  "people",
  "profile",
  "page",
  "visited",
  "read",
  "saw",
  "seen",
  "about",
  "what",
  "who",
  "when",
  "where",
  "which",
  "did",
  "was",
  "were",
  "have",
  "has",
  "my",
  "me",
  "i",
]);

function startEndDay(ts: number): { start: number; end: number } {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  d.setHours(23, 59, 59, 999);
  const end = d.getTime();
  return { start, end };
}

/**
 * Parse time phrases + quoted strings + "works at X" / CamelCase brands.
 */
export function parseAskQuery(raw: string): ParsedAskQuery {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  let timeRange: { start: number; end: number } | undefined;
  const now = Date.now();

  if (/\byesterday\b/.test(lower)) {
    const y = now - 86_400_000;
    timeRange = startEndDay(y);
  } else if (/\btoday\b/.test(lower)) {
    const se = startEndDay(now);
    timeRange = { start: se.start, end: Math.min(now, se.end) };
  } else if (/\blast\s*week\b/.test(lower)) {
    timeRange = { start: now - 7 * 86_400_000, end: now };
  } else if (/\blast\s*month\b/.test(lower)) {
    timeRange = { start: now - 30 * 86_400_000, end: now };
  }

  const preferLinkedIn =
    /\b(profile|linkedin|connection|who\s+works|employee)\b/i.test(trimmed) ||
    /\blinkedin\.com\b/i.test(trimmed);

  const entityTerms: string[] = [];

  for (const m of trimmed.matchAll(/"([^"]{2,120})"/g)) {
    entityTerms.push(m[1].trim());
  }

  const patterns: RegExp[] = [
    /\bworks?\s+at\s+([A-Za-z0-9][A-Za-z0-9&.+\-]{1,48})\b/i,
    /\bworks?\s+in\s+([A-Za-z0-9][A-Za-z0-9&.+\-]{1,48})\b/i,
    /\bemployed\s+(?:by|at)\s+([A-Za-z0-9][A-Za-z0-9&.+\-]{1,48})\b/i,
    /\bcompany\s+([A-Za-z0-9][A-Za-z0-9&.+\-]{1,48})\b/i,
    /\bat\s+([A-Za-z][A-Za-z0-9&.+\-]{2,48})\s+(?:yesterday|today|profile)/i,
  ];

  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m?.[1]) entityTerms.push(m[1].trim());
  }

  for (const m of trimmed.matchAll(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g)) {
    entityTerms.push(m[0]);
  }

  const uniq = [...new Set(entityTerms.map((t) => t.trim()))].filter((t) => {
    if (t.length < 2) return false;
    return !STOP.has(t.toLowerCase());
  });

  return {
    embeddingText: trimmed,
    entityTerms: uniq,
    timeRange,
    preferLinkedIn,
  };
}

export function buildEvidenceIntro(
  parsed: ParsedAskQuery,
  hitCount: number,
  timeRelaxed: boolean
): string {
  let s = `Showing ${hitCount} saved page${hitCount === 1 ? "" : "s"} from your library.`;
  if (parsed.timeRange && timeRelaxed) {
    s += " Nothing logged in that date window — widened to the closest matches.";
  } else if (parsed.timeRange && !timeRelaxed) {
    s += " Filtered to the visits in your date window.";
  }
  return s;
}
