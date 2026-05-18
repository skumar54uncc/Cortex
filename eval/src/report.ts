import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CORTEX_DB_SCHEMA_VERSION } from "../../src/shared/cortex-constants.js";
import { CORTEX_EMBED_MODEL_ID } from "../../src/shared/embed-model.js";
import type {
  AggregatedMetrics,
  BaselineDiffRow,
  EvalRun,
  QueryResult,
  QueryType,
} from "./types.js";
import { aggregateByQueryType, aggregateMetrics, percentile } from "./metrics.js";

const QUERY_TYPE_ORDER: QueryType[] = [
  "factual",
  "navigational",
  "exploratory",
  "negative",
];

export interface ReportOptions {
  resultsDir: string;
  writeBaseline: boolean;
  ciMode: boolean;
}

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function buildEvalRun(
  perQuery: QueryResult[],
  pagesCount: number,
  cacheMode: "cold" | "warm"
): EvalRun {
  const rows = perQuery.map((q) => ({
    queryType: q.query_type,
    metrics: q.metrics,
  }));
  const latencies = perQuery.map((q) => q.latencyMs).sort((a, b) => a - b);

  return {
    runId: new Date().toISOString(),
    environment: {
      node: process.version,
      embedModelId: CORTEX_EMBED_MODEL_ID,
      schemaVersion: CORTEX_DB_SCHEMA_VERSION,
      corpusPageCount: pagesCount,
      queryCount: perQuery.length,
      cacheMode,
    },
    perQuery,
    byQueryType: aggregateByQueryType(rows),
    overall: aggregateMetrics(rows),
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    },
  };
}

function printMetricsTable(title: string, m: AggregatedMetrics): void {
  console.info(`\n${title}`);
  console.info(
    `${pad("nDCG@10", 12)} ${pad("Recall@10", 12)} ${pad("MRR@10", 12)} ${pad("Neg pass", 12)} ${pad("n", 6)}`
  );
  console.info(
    `${pad(formatPct(m.nDCG10), 12)} ${pad(formatPct(m.recall10), 12)} ${pad(formatPct(m.mrr10), 12)} ${pad(formatPct(m.negativePassRate), 12)} ${pad(String(m.queryCount), 6)}`
  );
}

function printFailedQueries(perQuery: QueryResult[]): void {
  for (const q of perQuery) {
    const failed =
      q.query_type === "negative"
        ? !q.metrics.negativePass
        : q.metrics.recallAt10 < 1;
    if (!failed) continue;
    console.info(`\n✗ ${q.queryId} (${q.query_type}): "${q.query}"`);
    const top = q.hits.slice(0, 3);
    if (top.length === 0) {
      console.info("  (no hits)");
    } else {
      for (const h of top) {
        console.info(
          `  #${h.rank} score=${h.score.toFixed(3)} doc=${h.docId} — ${h.title}`
        );
      }
    }
  }
}

export function printConsoleReport(run: EvalRun): void {
  console.info("\n=== Cortex retrieval eval ===");
  console.info(`Run: ${run.runId}`);
  console.info(`Cache: ${run.environment.cacheMode}`);
  console.info(
    `Latency ms — p50: ${run.latencyMs.p50.toFixed(1)}  p95: ${run.latencyMs.p95.toFixed(1)}  p99: ${run.latencyMs.p99.toFixed(1)}`
  );

  for (const t of QUERY_TYPE_ORDER) {
    printMetricsTable(`By type: ${t}`, run.byQueryType[t]);
  }
  printMetricsTable("Overall", run.overall);
  printFailedQueries(run.perQuery);
}

export function writeRunJson(run: EvalRun, resultsDir: string): string {
  mkdirSync(resultsDir, { recursive: true });
  const safe = run.runId.replace(/[:.]/g, "-");
  const path = join(resultsDir, `run-${safe}.json`);
  writeFileSync(path, JSON.stringify(run, null, 2), "utf8");
  return path;
}

export function writeBaseline(run: EvalRun, resultsDir: string): string {
  const path = join(resultsDir, "baseline.json");
  writeFileSync(path, JSON.stringify(run, null, 2), "utf8");
  return path;
}

export function loadBaseline(resultsDir: string): EvalRun | null {
  const path = join(resultsDir, "baseline.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as EvalRun;
}

export function diffAgainstBaseline(
  current: EvalRun,
  baseline: EvalRun
): BaselineDiffRow[] {
  const rows: BaselineDiffRow[] = [];
  const pairs: [string, number, number][] = [
    ["nDCG@10 (overall)", baseline.overall.nDCG10, current.overall.nDCG10],
    ["Recall@10 (overall)", baseline.overall.recall10, current.overall.recall10],
    ["MRR@10 (overall)", baseline.overall.mrr10, current.overall.mrr10],
    ["p95 latency ms", baseline.latencyMs.p95, current.latencyMs.p95],
  ];
  for (const t of QUERY_TYPE_ORDER) {
    pairs.push([
      `nDCG@10 (${t})`,
      baseline.byQueryType[t].nDCG10,
      current.byQueryType[t].nDCG10,
    ]);
  }

  for (const [metric, base, cur] of pairs) {
    const delta = cur - base;
    const deltaPct = base !== 0 ? (delta / base) * 100 : cur !== 0 ? 100 : 0;
    let status: BaselineDiffRow["status"] = "ok";
    if (metric.includes("latency")) {
      if (deltaPct > 25) status = "regression";
      else if (deltaPct < -5) status = "improved";
    } else if (metric.includes("nDCG") && delta < -0.02) {
      status = "regression";
    } else if (metric.includes("nDCG") && delta > 0.02) {
      status = "improved";
    }
    rows.push({ metric, baseline: base, current: cur, delta, deltaPct, status });
  }
  return rows;
}

export function printDiffTable(rows: BaselineDiffRow[]): void {
  console.info("\n=== Diff vs baseline ===");
  for (const r of rows) {
    const tag =
      r.status === "regression" ? "REGRESSION" : r.status === "improved" ? "improved" : "ok";
    const sign = r.delta >= 0 ? "+" : "";
    console.info(
      `${pad(r.metric, 28)} ${r.baseline.toFixed(4)} → ${r.current.toFixed(4)} (${sign}${r.delta.toFixed(4)}, ${sign}${r.deltaPct.toFixed(1)}%) [${tag}]`
    );
  }
}

/** @param skipLatencyRegression — true when embed cache was cold (unfair vs warm baseline). */
export function ciRegressionFailed(
  rows: BaselineDiffRow[],
  opts?: { skipLatencyRegression?: boolean }
): boolean {
  return rows.some((r) => {
    if (opts?.skipLatencyRegression && r.metric.includes("latency")) {
      return false;
    }
    return r.status === "regression";
  });
}
