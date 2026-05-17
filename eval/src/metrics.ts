import type { AggregatedMetrics, QueryType } from "./types";

export interface RankedDoc {
  docId: string;
  rank: number;
}

export interface MetricInput {
  ranked: RankedDoc[];
  relevantDocIds: string[];
  queryType: QueryType;
  topScore: number;
}

export interface MetricOutput {
  dcg: number;
  idcg: number;
  ndcg: number;
  reciprocalRank: number;
  recallAt10: number;
  negativePass: boolean;
}

const NEGATIVE_SCORE_CEILING = 0.08;

function log2(n: number): number {
  return Math.log(n) / Math.LN2;
}

/** Binary-gain DCG@k (1-indexed ranks). */
export function dcgAtK(relevant: Set<string>, ranked: RankedDoc[], k: number): number {
  let sum = 0;
  const limit = Math.min(k, ranked.length);
  for (let i = 0; i < limit; i++) {
    const row = ranked[i]!;
    const rel = relevant.has(row.docId) ? 1 : 0;
    if (rel > 0) {
      sum += (Math.pow(2, rel) - 1) / log2(row.rank + 1);
    }
  }
  return sum;
}

export function idcgAtK(relevant: Set<string>, k: number): number {
  const n = Math.min(k, relevant.size);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (Math.pow(2, 1) - 1) / log2(i + 2);
  }
  return sum;
}

export function computeQueryMetrics(input: MetricInput): MetricOutput {
  const relevant = new Set(input.relevantDocIds);
  const k = 10;
  const dcg = dcgAtK(relevant, input.ranked, k);
  const idcg = idcgAtK(relevant, k);
  const ndcg = idcg > 0 ? dcg / idcg : relevant.size === 0 ? 1 : 0;

  let reciprocalRank = 0;
  let recallAt10 = 0;
  for (const row of input.ranked) {
    if (row.rank > k) continue;
    if (relevant.has(row.docId)) {
      if (reciprocalRank === 0) reciprocalRank = 1 / row.rank;
      recallAt10 = 1;
    }
  }

  let negativePass = true;
  if (input.queryType === "negative") {
    const anyHit = input.ranked.length > 0 && input.topScore >= NEGATIVE_SCORE_CEILING;
    negativePass = !anyHit;
    return {
      dcg,
      idcg,
      ndcg: negativePass ? 1 : 0,
      reciprocalRank: negativePass ? 1 : 0,
      recallAt10: negativePass ? 1 : 0,
      negativePass,
    };
  }

  return {
    dcg,
    idcg,
    ndcg,
    reciprocalRank,
    recallAt10,
    negativePass: true,
  };
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[idx] ?? 0;
}

export function aggregateMetrics(
  rows: { queryType: QueryType; metrics: MetricOutput }[]
): AggregatedMetrics {
  if (rows.length === 0) {
    return { nDCG10: 0, recall10: 0, mrr10: 0, negativePassRate: 1, queryCount: 0 };
  }
  let nDCG10 = 0;
  let recall10 = 0;
  let mrr10 = 0;
  let negativePass = 0;
  let negativeCount = 0;
  for (const r of rows) {
    nDCG10 += r.metrics.ndcg;
    recall10 += r.metrics.recallAt10;
    mrr10 += r.metrics.reciprocalRank;
    if (r.queryType === "negative") {
      negativeCount++;
      if (r.metrics.negativePass) negativePass++;
    }
  }
  const n = rows.length;
  return {
    nDCG10: nDCG10 / n,
    recall10: recall10 / n,
    mrr10: mrr10 / n,
    negativePassRate: negativeCount > 0 ? negativePass / negativeCount : 1,
    queryCount: n,
  };
}

export function aggregateByQueryType(
  rows: { queryType: QueryType; metrics: MetricOutput }[]
): Record<QueryType, AggregatedMetrics> {
  const types: QueryType[] = [
    "factual",
    "navigational",
    "exploratory",
    "negative",
  ];
  const out = {} as Record<QueryType, AggregatedMetrics>;
  for (const t of types) {
    out[t] = aggregateMetrics(rows.filter((r) => r.queryType === t));
  }
  return out;
}
