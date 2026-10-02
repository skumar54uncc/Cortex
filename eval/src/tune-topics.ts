/**
 * One shot: embed the topic catalog and the fixture pages, then print a threshold sweep.
 * Writes the label vectors and the fixture vectors. Does not edit the locked threshold.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOPIC_CATALOG } from "../../src/assistant-sync/topic-catalog.js";
import { tagTopics } from "../../src/assistant-sync/topics.js";
import { cosineSimilarity } from "../../src/lib/similarity.js";
import { CORTEX_EMBED_MODEL_ID } from "../../src/shared/embed-model.js";
import { TOPIC_FIXTURES } from "../queries/topic-fixtures.js";
import { embedText } from "./embed-node.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

function round(vector: number[]): number[] {
  return vector.map((n) => Math.round(n * 1e5) / 1e5);
}

function precisionRecall(
  cases: { expected: string[]; predicted: string[] }[]
): { precision: number; recall: number } {
  let hit = 0;
  let predicted = 0;
  let relevant = 0;
  for (const row of cases) {
    const expected = new Set(row.expected);
    predicted += row.predicted.length;
    relevant += row.expected.length;
    for (const label of row.predicted) if (expected.has(label)) hit += 1;
  }
  return {
    precision: predicted === 0 ? 1 : hit / predicted,
    recall: relevant === 0 ? 1 : hit / relevant,
  };
}

async function main(): Promise<void> {
  const labels: { label: string; vector: number[] }[] = [];
  for (const topic of TOPIC_CATALOG) {
    labels.push({ label: topic.label, vector: round(await embedText(topic.embed)) });
  }
  writeFileSync(
    join(ROOT, "src", "assistant-sync", "topic-label-embeddings.json"),
    JSON.stringify({ modelId: CORTEX_EMBED_MODEL_ID, labels }),
    "utf8"
  );

  const cases: {
    id: string;
    expected: string[];
    vector: number[];
    top: { label: string; score: number }[];
  }[] = [];
  for (const fixture of TOPIC_FIXTURES) {
    const vector = round(await embedText(fixture.text));
    const scored = labels
      .map((label) => ({ label: label.label, score: cosineSimilarity(vector, label.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    cases.push({ id: fixture.id, expected: fixture.expected, vector, top: scored });
    console.info(
      fixture.id,
      scored.map((row) => `${row.label} ${row.score.toFixed(3)}`).join(" | ")
    );
  }
  writeFileSync(
    join(ROOT, "eval", "queries", "topic-fixture-embeddings.json"),
    JSON.stringify({ modelId: CORTEX_EMBED_MODEL_ID, cases: cases.map(({ top: _top, ...rest }) => rest) }),
    "utf8"
  );

  console.info("\nthreshold\tprecision\trecall");
  for (const threshold of [0.3, 0.35, 0.4, 0.42, 0.45, 0.48, 0.5, 0.55, 0.6]) {
    const scored = cases.map((row) => ({
      expected: row.expected,
      predicted: tagTopics(row.vector, threshold, labels),
    }));
    const metrics = precisionRecall(scored);
    const misses = scored
      .map((row, i) => ({ id: cases[i]!.id, ...row }))
      .filter((row) => row.predicted.join("|") !== row.expected.join("|"));
    console.info(
      `${threshold.toFixed(2)}\t${metrics.precision.toFixed(3)}\t${metrics.recall.toFixed(3)}\t${misses
        .map((row) => `${row.id}[${row.predicted.join(",") || "-"}]`)
        .join(" ")}`
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
