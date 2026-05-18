/** Lexical grounding helpers — reduce false “strong” matches on generic words only. */

/** Low-IDF-style terms that should not alone justify top ranks */
export const GENERIC_QUERY_TERMS = new Set([
  "about",
  "administrative",
  "career",
  "careers",
  "content",
  "creator",
  "creators",
  "days",
  "exploration",
  "focused",
  "health",
  "job",
  "jobs",
  "last",
  "library",
  "manager",
  "moment",
  "operations",
  "page",
  "pages",
  "platform",
  "portal",
  "profile",
  "reading",
  "recent",
  "results",
  "role",
  "roles",
  "search",
  "site",
  "sites",
  "support",
  "today",
  "week",
  "work",
  "working",
  "yesterday",
]);

export interface QueryGrounding {
  /** Share of all query terms found in title/url/body */
  overall: number;
  /** Share of distinctive (non-generic) query terms found */
  distinctive: number;
  /** Any multi-word entity phrase matched */
  entityPhraseHit: boolean;
}

export function distinctiveQueryTerms(terms: string[]): string[] {
  return terms.filter(
    (t) => t.length >= 4 && !GENERIC_QUERY_TERMS.has(t.toLowerCase())
  );
}

export function computeQueryGrounding(
  corpus: string,
  url: string,
  title: string,
  queryTerms: string[],
  entityTerms: string[]
): QueryGrounding {
  const pool = `${url}\n${title}\n${corpus}`.toLowerCase();
  const terms = queryTerms.filter((t) => t.length >= 2);
  if (terms.length === 0) {
    return { overall: 0, distinctive: 0, entityPhraseHit: false };
  }

  let matched = 0;
  for (const t of terms) {
    if (pool.includes(t.toLowerCase())) matched++;
  }
  const overall = matched / terms.length;

  const dist = distinctiveQueryTerms(terms);
  let distinctive = 0;
  if (dist.length > 0) {
    let dMatched = 0;
    for (const t of dist) {
      if (pool.includes(t.toLowerCase())) dMatched++;
    }
    distinctive = dMatched / dist.length;
  } else {
    distinctive = overall;
  }

  let entityPhraseHit = false;
  for (const phrase of entityTerms) {
    const p = phrase.trim().toLowerCase();
    if (p.length < 4) continue;
    if (pool.includes(p)) {
      entityPhraseHit = true;
      break;
    }
  }

  return { overall, distinctive, entityPhraseHit };
}

/** 0–1 multiplier applied to fused rank score */
export function relevanceMultiplier(grounding: QueryGrounding): number {
  const dist = grounding.distinctive;
  const overall = grounding.overall;

  let mult = 0.38 + 0.62 * overall;
  if (dist < 0.34) {
    mult *= 0.42 + 0.35 * dist;
  } else {
    mult *= 0.55 + 0.45 * dist;
  }

  if (grounding.entityPhraseHit) {
    mult = Math.min(1.5, mult * 1.22);
  }

  return Math.min(1.35, Math.max(0.08, mult));
}

export function groundingForConfidence(grounding: QueryGrounding): number {
  if (grounding.entityPhraseHit) {
    return Math.min(1, 0.25 + 0.75 * Math.max(grounding.distinctive, grounding.overall));
  }
  return Math.min(1, 0.15 + 0.85 * grounding.distinctive);
}

export function domainPhraseBoost(
  url: string,
  title: string,
  queryTerms: string[],
  entityTerms: string[]
): number {
  const hay = `${url} ${title}`.toLowerCase();
  let bonus = 0;

  for (const phrase of entityTerms) {
    const p = phrase.trim().toLowerCase();
    if (p.length >= 4 && hay.includes(p)) bonus += 0.14;
  }

  const dist = distinctiveQueryTerms(queryTerms);
  for (const t of dist) {
    if (hay.includes(t)) bonus += 0.06;
  }

  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    for (const t of dist) {
      if (host.includes(t)) bonus += 0.1;
    }
  } catch {
    /* ignore */
  }

  return Math.min(0.32, bonus);
}
