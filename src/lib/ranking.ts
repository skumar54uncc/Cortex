import { keywordScore } from "./similarity";

/** Stronger matching when query tokens appear in title */
export function titleMatchScore(title: string, query: string): number {
  const qWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  if (qWords.length === 0) return 0;
  const t = title.toLowerCase();
  let hits = 0;
  for (const w of qWords) {
    if (t.includes(w)) hits += 1;
  }
  return hits / qWords.length;
}

/** Recency prior: half-life ~18 days */
export function recencyBoost(visitedAt: number, halfLifeDays = 18): number {
  const ageDays = (Date.now() - visitedAt) / 86_400_000;
  if (ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export interface HybridParts {
  cosine: number;
  keyword: number;
  titleMatch: number;
  visitedAt: number;
}

/**
 * Hybrid ranker: cosine + lexical + title alignment + soft recency.
 * Without embeddings, keyword/title/recency carry search.
 */
export function hybridScore(parts: HybridParts): number {
  const { cosine, keyword, titleMatch, visitedAt } = parts;
  const rec = recencyBoost(visitedAt);

  const hasSemantic = cosine > 0.02;

  if (hasSemantic) {
    return (
      0.58 * cosine + 0.17 * keyword + 0.13 * titleMatch + 0.12 * rec
    );
  }

  return 0.52 * keyword + 0.28 * titleMatch + 0.2 * rec;
}

export interface HybridProductionParts {
  cosine: number;
  keyword: number;
  titleMatch: number;
  visitedAt: number;
  /** 0–1 importance / engagement roll-up */
  engagement: number;
}

/**
 * Production-style blend: semantic + keyword + recency + engagement.
 * When cosine is negligible, emphasize lexical + recency + engagement.
 */
export function hybridProduction(parts: HybridProductionParts): number {
  const rec = recencyBoost(parts.visitedAt);
  const eng = Math.min(1, Math.max(0, parts.engagement));
  const lexical =
    qLex(parts.keyword, parts.titleMatch);

  const hasSemantic = parts.cosine > 0.02;

  if (hasSemantic) {
    return (
      0.55 * parts.cosine +
      0.25 * lexical +
      0.1 * rec +
      0.1 * eng
    );
  }

  return 0.42 * lexical + 0.33 * rec + 0.25 * eng;
}

function qLex(keyword: number, titleMatch: number): number {
  return 0.82 * keyword + 0.18 * titleMatch;
}
