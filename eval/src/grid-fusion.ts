/**
 * Offline grid over fuseRankScore. Builds the corpus once, then reranks.
 * A point is kept only when every core-slice nDCG holds versus the current
 * constants. Prints the best held point. Does not edit production weights.
 */
import "fake-indexeddb/auto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTestDb } from "./build-test-db.js";
import { EVAL_PINNED_NOW_MS } from "./clock.js";
import { loadCorpusFromFile, loadQueriesFromFile } from "./load-corpus.js";
import { aggregateByQueryType, aggregateMetrics } from "./metrics.js";
import { buildUrlToDocIdMap, runRetrievalEval } from "./run-retrieval.js";
import {
  FUSION_WITH_SEMANTIC,
  type FusionOverride,
  type FusionVector,
} from "../../src/lib/search-engine.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const NEAR_CURRENT: FusionVector[] = [
  { cosine: 0.48, lexical: 0.24, recency: 0.12, engagement: 0.16 },
  { cosine: 0.5, lexical: 0.24, recency: 0.1, engagement: 0.16 },
  { cosine: 0.48, lexical: 0.26, recency: 0.1, engagement: 0.16 },
  { cosine: 0.48, lexical: 0.24, recency: 0.08, engagement: 0.2 },
  { cosine: 0.48, lexical: 0.24, recency: 0.1, engagement: 0.18 },
  { cosine: 0.5, lexical: 0.22, recency: 0.1, engagement: 0.18 },
  { cosine: 0.46, lexical: 0.24, recency: 0.12, engagement: 0.18 },
  { cosine: 0.48, lexical: 0.22, recency: 0.12, engagement: 0.18 },
  { cosine: 0.44, lexical: 0.24, recency: 0.12, engagement: 0.2 },
  { cosine: 0.48, lexical: 0.24, recency: 0.04, engagement: 0.24 },
];

function vectors(): FusionVector[] {
  if (process.argv.includes("--near")) return NEAR_CURRENT;
  const out: FusionVector[] = [{ ...FUSION_WITH_SEMANTIC }];
  const cosines = [0.36, 0.48, 0.6];
  const lexicals = [0.16, 0.24, 0.36];
  const recencies = [0, 0.06, 0.12, 0.2];
  for (const cosine of cosines) {
    for (const lexical of lexicals) {
      for (const recency of recencies) {
        const engagement = Math.round((1 - cosine - lexical - recency) * 1000) / 1000;
        if (engagement < 0 || engagement > 0.3) continue;
        out.push({ cosine, lexical, recency, engagement });
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((v) => {
    const key = `${v.cosine}|${v.lexical}|${v.recency}|${v.engagement}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function withoutSemantic(w: FusionVector): FusionVector {
  const rest = w.lexical + w.recency + w.engagement;
  if (rest <= 0) return { cosine: 0, lexical: 1, recency: 0, engagement: 0 };
  return {
    cosine: 0,
    lexical: w.lexical / rest,
    recency: w.recency / rest,
    engagement: w.engagement / rest,
  };
}

function override(w: FusionVector): FusionOverride {
  return { withSemantic: w, withoutSemantic: withoutSemantic(w) };
}

async function main(): Promise<void> {
  const pages = loadCorpusFromFile(join(ROOT, "corpus", "pages.jsonl"));
  const queries = loadQueriesFromFile(join(ROOT, "queries", "retrieval.jsonl"));
  await buildTestDb(pages);
  const urlToDocId = buildUrlToDocIdMap(pages);
  if (process.argv.includes("--diff-neighbor")) {
    const neighbor: FusionVector = { cosine: 0.48, lexical: 0.24, recency: 0.08, engagement: 0.2 };
    const a = await runRetrievalEval(queries, urlToDocId, EVAL_PINNED_NOW_MS, override({ ...FUSION_WITH_SEMANTIC }));
    const b = await runRetrievalEval(queries, urlToDocId, EVAL_PINNED_NOW_MS, override(neighbor));
    for (let i = 0; i < a.length; i++) {
      const d = b[i]!.metrics.ndcg - a[i]!.metrics.ndcg;
      if (Math.abs(d) < 1e-6) continue;
      console.info(
        `${d > 0 ? "+" : ""}${d.toFixed(3)} ${a[i]!.query_type} ${a[i]!.queryId} ${a[i]!.query}`
      );
    }
    return;
  }

  const points = vectors();
  console.info(`grid points ${points.length}`);

  let best: { w: FusionVector; nDCG: number; line: string } | null = null;
  let currentLine = "";
  let currentNDCG = 0;

  for (const [i, w] of points.entries()) {
    const perQuery = await runRetrievalEval(queries, urlToDocId, EVAL_PINNED_NOW_MS, override(w));
    const rows = perQuery.map((q) => ({ queryType: q.query_type, metrics: q.metrics }));
    const overall = aggregateMetrics(rows);
    const by = aggregateByQueryType(rows);
    const line = [
      w.cosine.toFixed(2),
      w.lexical.toFixed(2),
      w.recency.toFixed(2),
      w.engagement.toFixed(2),
      overall.nDCG10.toFixed(4),
      overall.recall10.toFixed(4),
      overall.mrr10.toFixed(4),
      by.factual.nDCG10.toFixed(4),
      by.navigational.nDCG10.toFixed(4),
      by.exploratory.nDCG10.toFixed(4),
      by.negative.nDCG10.toFixed(4),
    ].join("\t");
    const isCurrent =
      w.cosine === FUSION_WITH_SEMANTIC.cosine &&
      w.lexical === FUSION_WITH_SEMANTIC.lexical &&
      w.recency === FUSION_WITH_SEMANTIC.recency &&
      w.engagement === FUSION_WITH_SEMANTIC.engagement;
    if (isCurrent) {
      currentLine = line;
      currentNDCG = overall.nDCG10;
    }
    console.info(`${String(i + 1).padStart(2)} ${line}`);
    if (!best || overall.nDCG10 > best.nDCG) best = { w, nDCG: overall.nDCG10, line };
  }

  console.info("\ncurrent\t" + currentLine);
  console.info("best   \t" + (best?.line ?? ""));
  console.info("best beats current", best != null && best.nDCG > currentNDCG + 1e-6);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
