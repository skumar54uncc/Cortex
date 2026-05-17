import { describe, expect, it } from "vitest";
import { computeQueryMetrics, dcgAtK, idcgAtK } from "../src/metrics";

describe("metrics", () => {
  it("perfect ranking → nDCG=1, MRR=1, Recall=1", () => {
    const m = computeQueryMetrics({
      ranked: [{ docId: "a", rank: 1 }],
      relevantDocIds: ["a"],
      queryType: "factual",
      topScore: 0.9,
    });
    expect(m.ndcg).toBeCloseTo(1, 5);
    expect(m.reciprocalRank).toBe(1);
    expect(m.recallAt10).toBe(1);
  });

  it("all wrong → nDCG=0, MRR=0, Recall=0", () => {
    const m = computeQueryMetrics({
      ranked: [{ docId: "x", rank: 1 }],
      relevantDocIds: ["a"],
      queryType: "factual",
      topScore: 0.5,
    });
    expect(m.ndcg).toBe(0);
    expect(m.reciprocalRank).toBe(0);
    expect(m.recallAt10).toBe(0);
  });

  it("relevant at rank 3 → MRR=1/3", () => {
    const m = computeQueryMetrics({
      ranked: [
        { docId: "x", rank: 1 },
        { docId: "y", rank: 2 },
        { docId: "a", rank: 3 },
      ],
      relevantDocIds: ["a"],
      queryType: "factual",
      topScore: 0.5,
    });
    expect(m.reciprocalRank).toBeCloseTo(1 / 3, 5);
    expect(m.recallAt10).toBe(1);
    const idcg = idcgAtK(new Set(["a"]), 10);
    const dcg = dcgAtK(new Set(["a"]), [{ docId: "a", rank: 3 }], 10);
    expect(m.ndcg).toBeCloseTo(dcg / idcg, 5);
  });

  it("empty results → zeros without error", () => {
    const m = computeQueryMetrics({
      ranked: [],
      relevantDocIds: ["a"],
      queryType: "factual",
      topScore: 0,
    });
    expect(m.ndcg).toBe(0);
    expect(m.recallAt10).toBe(0);
  });

  it("multiple relevant docs — DCG sums both hits", () => {
    const relevant = new Set(["a", "b"]);
    const ranked = [
      { docId: "a", rank: 1 },
      { docId: "b", rank: 2 },
    ];
    const dcg = dcgAtK(relevant, ranked, 10);
    const idcg = idcgAtK(relevant, 10);
    expect(dcg).toBeCloseTo(idcg, 5);
    const m = computeQueryMetrics({
      ranked,
      relevantDocIds: ["a", "b"],
      queryType: "exploratory",
      topScore: 0.8,
    });
    expect(m.ndcg).toBeCloseTo(1, 5);
  });

  it("negative query passes with no strong hits", () => {
    const m = computeQueryMetrics({
      ranked: [],
      relevantDocIds: [],
      queryType: "negative",
      topScore: 0,
    });
    expect(m.negativePass).toBe(true);
  });

  it("negative query fails when high-score hit returned", () => {
    const m = computeQueryMetrics({
      ranked: [{ docId: "x", rank: 1 }],
      relevantDocIds: [],
      queryType: "negative",
      topScore: 0.5,
    });
    expect(m.negativePass).toBe(false);
  });
});
