import { describe, it, expect } from "vitest";
import { parseDigestOutput } from "./digest-engine";
import type { ChunkWithDoc } from "../search-engine";

function makeChunks(n: number): ChunkWithDoc[] {
  const out: ChunkWithDoc[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      id: i,
      documentId: i,
      ord: 0,
      text: `body ${i}`,
      document: {
        id: i,
        url: `https://ex.test/p${i}`,
        domain: "ex.test",
        title: `Title ${i}`,
        summary: "",
        lastVisitedAt: Date.now(),
        visitCount: 1,
        importanceScore: 0.5,
      },
    });
  }
  return out;
}

describe("parseDigestOutput", () => {
  it("parses well-formed sections", () => {
    const chunks = makeChunks(2);
    const raw = `
NARRATIVE: You read about cats and servers.

TOPICS:
- Cats (2 pages)
- Servers (1 pages)

INSIGHTS:
- Fluffy prefers tuna [1]
- Latency matters [2]
`;
    const p = parseDigestOutput(raw, chunks);
    expect(p.narrative).toContain("cats");
    expect(p.topics).toHaveLength(2);
    expect(p.topics[0]!.topic).toContain("Cats");
    expect(p.insights).toHaveLength(2);
    expect(p.insights[0]!.sourceUrl).toBe(chunks[0]!.document.url);
  });

  it("handles missing TOPICS (empty topics)", () => {
    const chunks = makeChunks(1);
    const raw = `
NARRATIVE: Only narrative here.

INSIGHTS:
- One thing [1]
`;
    const p = parseDigestOutput(raw, chunks);
    expect(p.topics).toEqual([]);
    expect(p.insights).toHaveLength(1);
  });

  it("handles missing INSIGHTS", () => {
    const chunks = makeChunks(1);
    const raw = `
NARRATIVE: Hello world.

TOPICS:
- Solo (1 page)
`;
    const p = parseDigestOutput(raw, chunks);
    expect(p.insights).toEqual([]);
  });

  it("drops malformed citations and out-of-range indexes", () => {
    const chunks = makeChunks(2);
    const raw = `
NARRATIVE: x

TOPICS:
- bad line without regex match

INSIGHTS:
- no citation here
- broken [abc]
- missing [99]
- ok [1]
`;
    const p = parseDigestOutput(raw, chunks);
    expect(p.insights.map((i) => i.text)).toContain("ok");
    expect(p.insights.some((i) => i.text.includes("broken"))).toBe(false);
  });

  it("does not throw on empty raw text", () => {
    const chunks = makeChunks(1);
    expect(() => parseDigestOutput("", chunks)).not.toThrow();
    const p = parseDigestOutput("", chunks);
    expect(Array.isArray(p.topics)).toBe(true);
    expect(Array.isArray(p.insights)).toBe(true);
  });
});
