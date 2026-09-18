/**
 * Sweep abstain floors over one eval run JSON (Phase 3.3).
 *
 * For each candidate floor T: a negative query passes when its top score is
 * below T (the engine would abstain); a positive query loses Recall@10 when
 * it had a relevant hit but its top score is below T (the engine would now
 * abstain on it too). Prints negatives pass rate and Recall@10 loss per T.
 *
 * Usage: npx tsx eval/src/calibrate-abstain.ts eval/results/run-....json
 */
import { readFileSync } from "node:fs";
import type { EvalRun } from "./types";

export interface FloorRow {
  floor: number;
  negativesPass: number;
  negativesTotal: number;
  negativesPassRate: number;
  positivesTotal: number;
  positivesAbstained: number;
  recallLossPoints: number;
}

export function sweepAbstainFloors(run: EvalRun, floors: number[]): FloorRow[] {
  const negatives = run.perQuery.filter((q) => q.query_type === "negative");
  const positives = run.perQuery.filter((q) => q.query_type !== "negative");
  const positivesWithRecall = positives.filter((q) => q.metrics.recallAt10 === 1);
  return floors.map((floor) => {
    const negPass = negatives.filter((q) => (q.hits[0]?.score ?? 0) < floor).length;
    const lost = positivesWithRecall.filter((q) => (q.hits[0]?.score ?? 0) < floor).length;
    return {
      floor,
      negativesPass: negPass,
      negativesTotal: negatives.length,
      negativesPassRate: negatives.length ? negPass / negatives.length : 1,
      positivesTotal: positives.length,
      positivesAbstained: lost,
      recallLossPoints: positives.length ? (100 * lost) / positives.length : 0,
    };
  });
}

function main(): void {
  const path = process.argv[2];
  if (!path) throw new Error("run JSON path required");
  const run = JSON.parse(readFileSync(path, "utf8")) as EvalRun;
  const floors: number[] = [];
  for (let f = 0.06; f <= 0.4; f += 0.01) floors.push(Number(f.toFixed(2)));
  const rows = sweepAbstainFloors(run, floors);
  console.log("floor  neg_pass  neg_rate  pos_abstained  recall_loss_pts");
  for (const r of rows) {
    console.log(
      `${r.floor.toFixed(2)}   ${String(r.negativesPass).padStart(2)}/${r.negativesTotal}    ${(100 * r.negativesPassRate).toFixed(1).padStart(5)}%   ${String(r.positivesAbstained).padStart(3)}/${r.positivesTotal}        ${r.recallLossPoints.toFixed(2)}`
    );
  }
  const negTop = run.perQuery
    .filter((q) => q.query_type === "negative")
    .map((q) => (q.hits[0]?.score ?? 0).toFixed(3))
    .sort();
  console.log("negative top scores:", negTop.join(" "));
  const posTop = run.perQuery
    .filter((q) => q.query_type !== "negative")
    .map((q) => (q.hits[0]?.score ?? 0))
    .sort((a, b) => a - b)
    .slice(0, 15)
    .map((s) => s.toFixed(3));
  console.log("lowest positive top scores:", posTop.join(" "));
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("calibrate-abstain.ts");
if (isMain) main();
