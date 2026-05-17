export type PageCategory =
  | "wikipedia"
  | "docs"
  | "blog"
  | "news"
  | "spa"
  | "long-form";

export interface CorpusPage {
  id: string;
  url: string;
  title: string;
  html: string;
  extracted_text: string;
  captured_at: string;
  category: PageCategory;
}

export type QueryType =
  | "factual"
  | "navigational"
  | "exploratory"
  | "negative";

export interface RetrievalQuery {
  id: string;
  query: string;
  relevant_doc_ids: string[];
  relevant_chunk_ids: string[];
  query_type: QueryType;
  notes?: string;
}

export interface RetrievalHit {
  rank: number;
  docId: string;
  url: string;
  title: string;
  score: number;
  snippet: string;
}

export interface QueryMetrics {
  dcg: number;
  idcg: number;
  ndcg: number;
  reciprocalRank: number;
  recallAt10: number;
  negativePass: boolean;
}

export interface QueryResult {
  queryId: string;
  query: string;
  query_type: QueryType;
  latencyMs: number;
  hits: RetrievalHit[];
  relevant_doc_ids: string[];
  metrics: QueryMetrics;
}

export interface AggregatedMetrics {
  nDCG10: number;
  recall10: number;
  mrr10: number;
  negativePassRate: number;
  queryCount: number;
}

export interface EvalRun {
  runId: string;
  environment: {
    node: string;
    embedModelId: string;
    schemaVersion: number;
    corpusPageCount: number;
    queryCount: number;
    cacheMode: "cold" | "warm";
  };
  perQuery: QueryResult[];
  byQueryType: Record<QueryType, AggregatedMetrics>;
  overall: AggregatedMetrics;
  latencyMs: { p50: number; p95: number; p99: number };
}

export interface BaselineDiffRow {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
  deltaPct: number;
  status: "ok" | "regression" | "improved";
}
