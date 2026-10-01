/**
 * Offline grid over the with-semantic fusion vector. The without-semantic
 * vector stays at FUSION_WITHOUT_SEMANTIC. Builds the corpus once, then
 * reranks. Prints every point and whether every core slice holds against
 * the production vector. Does not edit production weights.
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
  FUSION_WITHOUT_SEMANTIC,
  FUSION_WITH_SEMANTIC,
  type FusionOverride,
  type FusionVector,
} from "../../src/lib/search-engine.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const NEAR_CURRENT: FusionVector[] = [
  { cosine: 0.48, lexical: 0.24, recency: 0.12, engagement: 0.16 },
  { cosine: 0.36, lexical: 0.36, recency: 0.12, engagement: 0.16 },
  { cosine: 0.32, lexical: 0.36, recency: 0.12, engagement: 0.2 },
  { cosine: 0.4, lexical: 0.36, recency: 0.12, engagement: 0.12 },
  { cosine: 0.36, lexical: 0.32, recency: 0.12, engagement: 0.2 },
  { cosine: 0.36, lexical: 0.4, recency: 0.12, engagement: 0.12 },
  { cosine: 0.36, lexical: 0.36, recency: 0.08, engagement: 0.2 },
  { cosine: 0.36, lexical: 0.36, recency: 0.16, engagement: 0.12 },
  { cosine: 0.4, lexical: 0.32, recency: 0.12, engagement: 0.16 },
  { cosine: 0.48, lexical: 0.36, recency: 0.12, engagement: 0.04 },
];

function dedupe(vectorsIn: FusionVector[]): FusionVector[] {
  const seen = new Set<string>();
  return vectorsIn.filter((v) => {
    const key = `${v.cosine}|${v.lexical}|${v.recency}|${v.engagement}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function vectors(): FusionVector[] {
  if (process.argv.includes("--near")) {
    return dedupe([{ ...FUSION_WITH_SEMANTIC }, ...NEAR_CURRENT]);
  }
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
  return dedupe(out);
}

function override(w: FusionVector): FusionOverride {
  return { withSemantic: w, withoutSemantic: { ...FUSION_WITHOUT_SEMANTIC } };
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
  let incumbent: {
    nDCG: number;
    recall: number;
    mrr: number;
    factual: number;
    nav: number;
    expl: number;
    neg: number;
  } | null = null;

  for (const [i, w] of points.entries()) {
    const perQuery = await runRetrievalEval(queries, urlToDocId, EVAL_PINNED_NOW_MS, override(w));
    const rows = perQuery.map((q) => ({ queryType: q.query_type, metrics: q.metrics }));
    const overall = aggregateMetrics(rows);
    const by = aggregateByQueryType(rows);
    const point = {
      nDCG: overall.nDCG10,
      recall: overall.recall10,
      mrr: overall.mrr10,
      factual: by.factual.nDCG10,
      nav: by.navigational.nDCG10,
      expl: by.exploratory.nDCG10,
      neg: by.negative.nDCG10,
    };
    const line = [
      w.cosine.toFixed(2),
      w.lexical.toFixed(2),
      w.recency.toFixed(2),
      w.engagement.toFixed(2),
      point.nDCG.toFixed(4),
      point.recall.toFixed(4),
      point.mrr.toFixed(4),
      point.factual.toFixed(4),
      point.nav.toFixed(4),
      point.expl.toFixed(4),
      point.neg.toFixed(4),
    ].join("\t");
    const isCurrent =
      w.cosine === FUSION_WITH_SEMANTIC.cosine &&
      w.lexical === FUSION_WITH_SEMANTIC.lexical &&
      w.recency === FUSION_WITH_SEMANTIC.recency &&
      w.engagement === FUSION_WITH_SEMANTIC.engagement;
    if (isCurrent) {
      currentLine = line;
      currentNDCG = point.nDCG;
      incumbent = point;
    }
    const holds =
      incumbent != null &&
      point.nDCG >= incumbent.nDCG - 1e-9 &&
      point.recall >= incumbent.recall - 1e-9 &&
      point.mrr >= incumbent.mrr - 1e-9 &&
      point.factual >= incumbent.factual - 1e-9 &&
      point.nav >= incumbent.nav - 1e-9 &&
      point.expl >= incumbent.expl - 1e-9 &&
      point.neg >= incumbent.neg - 1e-9;
    console.info(`${String(i + 1).padStart(2)} ${line} ${holds ? "HOLD" : "DROP"}`);
    if (!best || point.nDCG > best.nDCG) best = { w, nDCG: point.nDCG, line };
  }

  console.info("\ncurrent\t" + currentLine);
  console.info("best   \t" + (best?.line ?? ""));
  console.info("best beats current", best != null && best.nDCG > currentNDCG + 1e-6);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
