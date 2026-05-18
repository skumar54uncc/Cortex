import "fake-indexeddb/auto";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildTestDb } from "./build-test-db.js";
import { isEmbeddingCacheWarm } from "./embed-node.js";
import { loadCorpusFromFile, loadQueriesFromFile } from "./load-corpus.js";
import { runRetrievalEval, buildUrlToDocIdMap } from "./run-retrieval.js";
import {
  buildEvalRun,
  ciRegressionFailed,
  diffAgainstBaseline,
  loadBaseline,
  printConsoleReport,
  printDiffTable,
  writeBaseline,
  writeRunJson,
} from "./report.js";

const EVAL_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function parseArgs(argv: string[]): {
  baseline: boolean;
  ci: boolean;
  override: boolean;
} {
  return {
    baseline: argv.includes("--baseline"),
    ci: argv.includes("--ci"),
    override: argv.includes("--eval-override"),
  };
}

export async function runEvalCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const pagesPath = join(EVAL_ROOT, "corpus", "pages.jsonl");
  const queriesPath = join(EVAL_ROOT, "queries", "retrieval.jsonl");
  const resultsDir = join(EVAL_ROOT, "results");

  const cacheWarmAtStart = isEmbeddingCacheWarm();
  const pages = loadCorpusFromFile(pagesPath);
  const queries = loadQueriesFromFile(queriesPath);

  console.info(`[eval] Indexing ${pages.length} pages…`);
  const built = await buildTestDb(pages);
  console.info(`[eval] Indexed ${built.documentCount} docs, ${built.chunkCount} chunks`);

  const urlToDocId = buildUrlToDocIdMap(pages);
  console.info(`[eval] Running ${queries.length} queries…`);
  const perQuery = await runRetrievalEval(queries, urlToDocId);

  const cacheMode: "cold" | "warm" = cacheWarmAtStart ? "warm" : "cold";
  const run = buildEvalRun(perQuery, pages.length, cacheMode);

  printConsoleReport(run);
  const outPath = writeRunJson(run, resultsDir);
  console.info(`\n[eval] Wrote ${outPath}`);

  if (args.baseline) {
    const basePath = writeBaseline(run, resultsDir);
    console.info(`[eval] Baseline updated → ${basePath}`);
    return 0;
  }

  const baseline = loadBaseline(resultsDir);
  if (baseline) {
    const diff = diffAgainstBaseline(run, baseline);
    printDiffTable(diff);
    const skipLatency =
      run.environment.cacheMode === "cold" &&
      baseline.environment.cacheMode === "warm";
    if (args.ci && ciRegressionFailed(diff, { skipLatencyRegression: skipLatency }) && !args.override) {
      if (skipLatency) {
        console.info(
          "\n[eval] Skipping p95 latency gate (cold embed cache vs warm baseline)."
        );
      }
      console.error("\n[eval] CI gate failed (nDCG −2% or p95 latency +25%).");
      console.error("Add [eval-override: reason] to the PR description to bypass.");
      return 1;
    }
  } else if (args.ci) {
    console.error("[eval] No baseline.json — run npm run eval -- --baseline locally first.");
    return 1;
  }

  return 0;
}

const isMain = Boolean(
  process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
);

if (isMain) {
  runEvalCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error("[eval] Fatal:", err);
      process.exitCode = 1;
    });
}
