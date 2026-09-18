import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, upsertDocument, replaceChunksForDocument } from "../src/db/schema";
import { chunkArticle, CHUNK_PROFILES, CHUNKING_VERSION } from "../src/lib/chunking";
import {
  findDocumentsNeedingRechunk,
  rechunkDocument,
  runRechunkBatch,
  RECHUNK_BATCH_SIZE,
} from "../src/lib/rechunk";

function wordsText(n: number, prefix = "w"): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join(" ");
}

async function seedLegacyDoc(url: string, words: number): Promise<number> {
  const id = await upsertDocument({
    url,
    domain: "legacy.test",
    title: `Legacy ${url}`,
    summary: "s",
    lastVisitedAt: Date.now(),
  });
  // Simulate a 1.0.x page: wide (420/75) chunks and no chunkingVersion.
  const parts = chunkArticle(wordsText(words), CHUNK_PROFILES.wide);
  await replaceChunksForDocument(id, parts);
  await db.documents.update(id, { chunkingVersion: undefined });
  return id;
}

describe("re-chunk job (Phase 3.4)", () => {
  beforeEach(async () => {
    await db.documents.clear();
    await db.chunks.clear();
    await db.visitLog.clear();
  });

  it("new documents record the current chunking version", async () => {
    const id = await upsertDocument({
      url: "https://new.test/a",
      domain: "new.test",
      title: "New",
      summary: "s",
      lastVisitedAt: Date.now(),
    });
    await replaceChunksForDocument(id, chunkArticle(wordsText(300)));
    const doc = await db.documents.get(id);
    expect(doc?.chunkingVersion).toBe(CHUNKING_VERSION);
  });

  it("finds only documents whose chunking version is missing or older", async () => {
    const legacy = await seedLegacyDoc("https://legacy.test/1", 900);
    const current = await upsertDocument({
      url: "https://new.test/b",
      domain: "new.test",
      title: "Current",
      summary: "s",
      lastVisitedAt: Date.now(),
    });
    await replaceChunksForDocument(current, chunkArticle(wordsText(300)));
    const ids = await findDocumentsNeedingRechunk(10);
    expect(ids).toEqual([legacy]);
  });

  it("rechunkDocument rebuilds the text from wide chunks and writes compact chunks with pending embeddings", async () => {
    const id = await seedLegacyDoc("https://legacy.test/2", 900);
    const before = await db.chunks.where("documentId").equals(id).toArray();
    expect(before.length).toBe(3); // 420/75 over 900 words
    const result = await rechunkDocument(id);
    expect(result.ok).toBe(true);
    const after = await db.chunks.where("documentId").equals(id).sortBy("ord");
    const expected = chunkArticle(wordsText(900), CHUNK_PROFILES.compact);
    expect(after.map((c) => c.text)).toEqual(expected.map((c) => c.text));
    expect(after.every((c) => c.embedState === "pending")).toBe(true);
    const doc = await db.documents.get(id);
    expect(doc?.chunkingVersion).toBe(CHUNKING_VERSION);
  });

  it("runRechunkBatch is throttled to a batch size and resumable: each call handles at most N docs", async () => {
    const ids: number[] = [];
    for (let i = 0; i < RECHUNK_BATCH_SIZE + 2; i++) {
      ids.push(await seedLegacyDoc(`https://legacy.test/batch-${i}`, 500));
    }
    const queued: number[][] = [];
    const first = await runRechunkBatch({ queueEmbeddings: async (chunkIds) => { queued.push(chunkIds); } });
    expect(first.processed).toBe(RECHUNK_BATCH_SIZE);
    expect(first.remaining).toBe(2);
    expect(queued.length).toBe(RECHUNK_BATCH_SIZE);
    const second = await runRechunkBatch({ queueEmbeddings: async () => undefined });
    expect(second.processed).toBe(2);
    expect(second.remaining).toBe(0);
    const third = await runRechunkBatch({ queueEmbeddings: async () => undefined });
    expect(third.processed).toBe(0);
    expect(third.remaining).toBe(0);
    const stale = await findDocumentsNeedingRechunk(100);
    expect(stale).toEqual([]);
  });

  it("a document whose chunks vanished is marked current without throwing", async () => {
    const id = await seedLegacyDoc("https://legacy.test/empty", 500);
    await db.chunks.where("documentId").equals(id).delete();
    const result = await rechunkDocument(id);
    expect(result.ok).toBe(false);
    const doc = await db.documents.get(id);
    expect(doc?.chunkingVersion).toBe(CHUNKING_VERSION);
    expect(vi.isMockFunction(rechunkDocument)).toBe(false);
  });
});
