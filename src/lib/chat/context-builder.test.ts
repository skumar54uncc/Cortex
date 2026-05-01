import { describe, it, expect } from "vitest";
import { selectChunksForBudget } from "./context-builder";
import type { ChunkWithDoc } from "../search-engine";

function chunk(
  id: number,
  documentId: number,
  text: string,
  docUrl = "https://ex.test"
): ChunkWithDoc {
  return {
    id,
    documentId,
    ord: 0,
    text,
    document: {
      id: documentId,
      url: docUrl,
      domain: "ex.test",
      title: "T",
      summary: "",
      lastVisitedAt: Date.now(),
      visitCount: 1,
      importanceScore: 0.5,
    },
  };
}

describe("selectChunksForBudget", () => {
  it("returns empty when no chunks fit", () => {
    const huge = chunk(1, 1, "x".repeat(500_000));
    expect(selectChunksForBudget([huge], 2000, 0)).toEqual([]);
  });

  it("returns empty for empty input", () => {
    expect(selectChunksForBudget([], 10_000, 100)).toEqual([]);
  });

  it("packs as many chunks as possible without exceeding budget", () => {
    const a = chunk(1, 1, "a".repeat(100));
    const b = chunk(2, 2, "b".repeat(100));
    const c = chunk(3, 3, "c".repeat(100));
    const maxPrompt = 5000;
    const q = 50;
    const picked = selectChunksForBudget([a, b, c], maxPrompt, q);
    expect(picked.length).toBeGreaterThanOrEqual(1);
    expect(picked.length).toBeLessThanOrEqual(3);
    let overhead = 1500;
    let used = 0;
    for (const ch of picked) {
      used += ch.text.length + 200;
    }
    expect(q + overhead + used).toBeLessThanOrEqual(maxPrompt);
  });

  it("stops before next chunk would exceed budget", () => {
    const small = chunk(1, 1, "hi");
    const big = chunk(2, 2, "z".repeat(50_000));
    const maxPrompt = 10_000;
    const picked = selectChunksForBudget([small, big], maxPrompt, 100);
    expect(picked).toHaveLength(1);
    expect(picked[0]!.id).toBe(1);
  });

  it("returns empty when budget cannot fit even one chunk after overhead", () => {
    const only = chunk(1, 1, "word");
    const maxPrompt = 1600;
    const picked = selectChunksForBudget([only], maxPrompt, 0);
    expect(picked).toEqual([]);
  });
});
