import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("../src/embed-node", () => ({
  embedText: vi.fn(async () => Array.from({ length: 384 }, (_, i) => (i % 10) * 0.01)),
}));

import { buildTestDb } from "../src/build-test-db";
import { db } from "../../src/db/schema";
import type { CorpusPage } from "../src/types";

const MINI_PAGES: CorpusPage[] = [
  {
    id: "mini-a",
    url: "https://example.test/mini/a",
    title: "Mini A",
    html: "<p>Alpha quantum sieve filters candidates in bucket one.</p>",
    extracted_text:
      "Alpha quantum sieve filters candidates in bucket one. The Ortega lattice is mentioned here.",
    captured_at: "2026-05-17T00:00:00Z",
    category: "docs",
  },
  {
    id: "mini-b",
    url: "https://example.test/mini/b",
    title: "Mini B",
    html: "<p>Beta Helix toolkit release notes for eval only.</p>",
    extracted_text:
      "Beta Helix toolkit release notes for eval only. Version 3.2 is fictional.",
    captured_at: "2026-05-17T00:00:00Z",
    category: "news",
  },
];

describe("build-test-db", () => {
  beforeEach(async () => {
    await db.documents.clear();
    await db.chunks.clear();
    await db.visitLog.clear();
  });

  it("indexes a 2-page corpus into fake-indexeddb", async () => {
    const result = await buildTestDb(MINI_PAGES);
    expect(result.documentCount).toBe(2);
    expect(result.chunkCount).toBeGreaterThan(0);

    const docs = await db.documents.toArray();
    const chunks = await db.chunks.toArray();
    expect(docs).toHaveLength(2);
    expect(chunks.length).toBe(result.chunkCount);
    expect(chunks.every((c) => c.embedding && c.embedding.length > 0)).toBe(true);
  });
});
