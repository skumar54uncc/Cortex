import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DocumentRecord, ChunkRecord } from "../db/schema";
import { runAdvancedSearch } from "./search-engine";

const mocks = vi.hoisted(() => ({
  docs: [] as DocumentRecord[],
  chunks: [] as ChunkRecord[],
  urlsInRange: new Set<string>(),
}));

vi.mock("../db/schema", () => ({
  db: {
    documents: {
      toArray: vi.fn(async () => mocks.docs),
    },
    chunks: {
      toArray: vi.fn(async () => mocks.chunks),
    },
  },
  getUrlsVisitedBetween: vi.fn(
    async (_start: number, _end: number) => mocks.urlsInRange
  ),
}));

function doc(
  id: number,
  url: string,
  title: string,
  visitedAt: number
): DocumentRecord {
  return {
    id,
    url,
    domain: new URL(url).hostname,
    title,
    summary: "",
    lastVisitedAt: visitedAt,
    visitCount: 1,
    importanceScore: 0.5,
  };
}

function ch(id: number, documentId: number, text: string, emb?: number[]): ChunkRecord {
  return {
    id,
    documentId,
    ord: 0,
    text,
    embedding: emb,
    embedState: emb?.length ? "embedded" : undefined,
  };
}

describe("runAdvancedSearch", () => {
  const now = 1_700_000_000_000;

  beforeEach(() => {
    mocks.docs = [];
    mocks.chunks = [];
    mocks.urlsInRange = new Set();
  });

  it("empty semantic query returns no hits without crashing", async () => {
    mocks.docs = [doc(1, "https://a.test/x", "A", now)];
    mocks.chunks = [ch(1, 1, "hello world")];
    const res = await runAdvancedSearch("   ", async () => null);
    expect(res.hits).toEqual([]);
  });

  it("returns guidance when tokenizable query has no letter tokens", async () => {
    mocks.docs = [doc(1, "https://a.test/x", "A", now)];
    mocks.chunks = [ch(1, 1, "hello")];
    const res = await runAdvancedSearch("@@@", async () => null);
    expect(res.hits).toEqual([]);
    expect(res.evidence).toMatch(/letters or numbers/i);
  });

  it("BM25 path runs when embeddings are missing", async () => {
    mocks.docs = [
      doc(1, "https://a.test/a", "Alpha", now),
      doc(2, "https://b.test/b", "Beta", now),
    ];
    mocks.chunks = [
      ch(1, 1, "kubernetes scheduling guide"),
      ch(2, 2, "unrelated cooking pasta"),
    ];
    const res = await runAdvancedSearch("kubernetes", async () => null);
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
    expect(res.hits[0]!.url).toContain("a.test");
  });

  it("respects maxHits", async () => {
    const dlist: DocumentRecord[] = [];
    const clist: ChunkRecord[] = [];
    for (let i = 1; i <= 6; i++) {
      const u = `https://multi.test/p${i}`;
      dlist.push(doc(i, u, `Page ${i}`, now));
      clist.push(ch(i, i, `alpha keyword unique ${i}`, undefined));
    }
    mocks.docs = dlist;
    mocks.chunks = clist;
    const res = await runAdvancedSearch("alpha keyword", async () => null, {
      maxHits: 2,
    });
    expect(res.hits.length).toBe(2);
  });

  it("time range filters to urls returned by visit log", async () => {
    mocks.docs = [
      doc(1, "https://x.test/in", "In", now),
      doc(2, "https://y.test/out", "Out", now),
    ];
    mocks.chunks = [
      ch(1, 1, "tensorflow basics"),
      ch(2, 2, "tensorflow advanced"),
    ];
    mocks.urlsInRange = new Set(["https://x.test/in"]);
    const res = await runAdvancedSearch("tensorflow", async () => null, {
      forceTimeRange: { start: now - 10_000, end: now + 10_000 },
    });
    expect(res.hits.every((h) => h.url === "https://x.test/in")).toBe(true);
  });

  it("semantic signal can reorder when embeddings exist", async () => {
    const v = new Array(384).fill(0);
    const qv = [...v];
    qv[0] = 1;
    const docVec = [...v];
    docVec[0] = 0.9;
    mocks.docs = [
      doc(1, "https://low.test/", "Low BM25", now),
      doc(2, "https://highsem.test/", "High sem", now),
    ];
    mocks.chunks = [
      ch(1, 1, "zzz unrelated text here", docVec),
      ch(2, 2, "also unrelated", [...v]),
    ];
    const res = await runAdvancedSearch(
      "anything",
      async () => qv,
      { maxHits: 5 }
    );
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
    const urls = res.hits.map((h) => h.url);
    expect(urls).toContain("https://low.test/");
  });

  it("adaptive cutoff removes very weak scores when stronger docs exist", async () => {
    mocks.docs = [
      doc(1, "https://strong.test/s", "S", now),
      doc(2, "https://weak.test/w", "W", now),
    ];
    mocks.chunks = [
      ch(1, 1, "quantum quantum quantum physics research"),
      ch(2, 2, "sandwich"),
    ];
    const res = await runAdvancedSearch("quantum physics", async () => null);
    expect(res.hits.some((h) => h.url.includes("strong"))).toBe(true);
    expect(res.hits.every((h) => h.score >= 0.028)).toBe(true);
  });
});
