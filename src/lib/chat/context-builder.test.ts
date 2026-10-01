import { describe, it, expect } from "vitest";
import { buildChatPrompt, expandChatEvidence, selectChunksForBudget } from "./context-builder";
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

describe("expandChatEvidence", () => {
  it("keeps the ranked passage and adds later passages from the same page that share the question", () => {
    const lead = chunk(1, 7, "Intro paragraph with no overlap.", "https://notes.test/a");
    lead.ord = 0;
    const later = chunk(2, 7, "The flux capacitor design is described here.", "https://notes.test/a");
    later.ord = 3;
    const otherPage = chunk(3, 8, "flux capacitor mention on a different site", "https://other.test/b");
    const picked = expandChatEvidence(
      [lead],
      [lead, later, otherPage],
      "where did I read about the flux capacitor"
    );
    expect(picked.map((c) => c.id)).toEqual([1, 2]);
  });

  it("does not repeat a passage that is already the best hit", () => {
    const only = chunk(4, 1, "flux capacitor");
    expect(expandChatEvidence([only], [only], "flux capacitor").map((c) => c.id)).toEqual([4]);
  });
});

describe("buildChatPrompt page summary", () => {
  it("includes the page summary once, on the first passage from that page", () => {
    const first = chunk(1, 9, "Opening.");
    const second = chunk(2, 9, "Later detail about capacitors.");
    first.document.summary = "A lab note about capacitors.";
    second.document.summary = "A lab note about capacitors.";
    const prompt = buildChatPrompt({ question: "capacitors", chunks: [first, second] });
    expect(prompt.match(/Page summary: A lab note about capacitors\./g)).toHaveLength(1);
    expect(prompt).toContain("Content: Opening.");
    expect(prompt).toContain("Content: Later detail about capacitors.");
  });
});
