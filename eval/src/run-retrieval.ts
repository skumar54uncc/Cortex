import { runAdvancedSearch } from "../../src/lib/search-engine.js";
import type { CorpusPage, RetrievalQuery, QueryResult, RetrievalHit } from "./types.js";
import { computeQueryMetrics } from "./metrics.js";
import { embedText } from "./embed-node.js";

export function buildUrlToDocIdMap(pages: CorpusPage[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of pages) {
    m.set(p.url, p.id);
  }
  return m;
}

export async function runRetrievalEval(
  queries: RetrievalQuery[],
  urlToDocId: Map<string, string>
): Promise<QueryResult[]> {
  const results: QueryResult[] = [];

  for (const q of queries) {
    const t0 = performance.now();
    const response = await runAdvancedSearch(q.query, embedText, { maxHits: 10 });
    const latencyMs = performance.now() - t0;

    const hits: RetrievalHit[] = (response.hits ?? []).slice(0, 10).map((h, i) => ({
      rank: i + 1,
      docId: urlToDocId.get(h.url) ?? h.url,
      url: h.url,
      title: h.title,
      score: h.score,
      snippet: h.snippet,
    }));

    const ranked = hits.map((h) => ({ docId: h.docId, rank: h.rank }));
    const topScore = hits[0]?.score ?? 0;
    const metrics = computeQueryMetrics({
      ranked,
      relevantDocIds: q.relevant_doc_ids,
      queryType: q.query_type,
      topScore,
    });

    results.push({
      queryId: q.id,
      query: q.query,
      query_type: q.query_type,
      latencyMs,
      hits,
      relevant_doc_ids: q.relevant_doc_ids,
      metrics,
    });
  }

  return results;
}
