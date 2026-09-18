import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, it, expect, beforeAll } from "vitest";

/**
 * Release 1.2.0 migration (Dexie v5 -> v6). A database is created with the
 * exact 1.0.1 (v5) schema and filled with data, then opened with the new
 * CortexDB. Nothing may be lost and old chunks must read as kind "text".
 */
const V5_STORES = {
  pages: "++id, url, visitedAt",
  visitLog: "++id, visitedAt, hostname, url",
  documents: "++id, url, domain, lastVisitedAt",
  chunks: "++id, documentId, ord",
  conversations: "++id, createdAt, updatedAt, title",
  messages: "++id, conversationId, timestamp",
  digestCache: "range, generatedAt",
};

const EMB = Array.from({ length: 384 }, (_, i) => ((i % 7) - 3) / 10);

async function buildV5Database(): Promise<Record<string, number>> {
  const v5 = new Dexie("cortex-db");
  v5.version(5).stores(V5_STORES);
  await v5.open();
  const docIds: number[] = [];
  for (let d = 0; d < 10; d++) {
    docIds.push(
      (await v5.table("documents").add({
        url: `https://site${d}.test/page`,
        domain: `site${d}.test`,
        title: `Page ${d}`,
        summary: "summary",
        lastVisitedAt: 1_700_000_000_000 + d,
        visitCount: 1,
        importanceScore: 0.1,
      })) as number
    );
  }
  for (const id of docIds) {
    for (let o = 0; o < 3; o++) {
      await v5.table("chunks").add({
        documentId: id,
        ord: o,
        text: `chunk ${o} of ${id}`,
        embedding: EMB,
        embedState: "embedded",
        embedModelId: "Xenova/all-MiniLM-L6-v2",
      });
    }
    await v5.table("visitLog").add({ url: `u${id}`, title: "t", hostname: "h", visitedAt: 1, textLength: 5 });
  }
  const conv = (await v5.table("conversations").add({ createdAt: 1, updatedAt: 2, title: "Chat A" })) as number;
  await v5.table("messages").bulkAdd([
    { conversationId: conv, role: "user", content: "q", timestamp: 1 },
    { conversationId: conv, role: "assistant", content: "a", timestamp: 2, citedChunksJson: "[]" },
  ]);
  const conv2 = (await v5.table("conversations").add({ createdAt: 3, updatedAt: 4, title: "Chat B" })) as number;
  await v5.table("messages").add({ conversationId: conv2, role: "user", content: "q2", timestamp: 3 });
  await v5.table("digestCache").put({ range: "today", generatedAt: 5, resultJson: "{}" });
  await v5.table("pages").add({ url: "https://legacy.test", title: "l", visitedAt: 1, text: "t", summary: "" });
  const counts: Record<string, number> = {};
  for (const name of Object.keys(V5_STORES)) counts[name] = await v5.table(name).count();
  v5.close();
  return counts;
}

describe("Dexie v5 -> v6 migration", () => {
  let before: Record<string, number>;
  beforeAll(async () => {
    before = await buildV5Database();
  });

  it("opens the 1.0.1 database without losing any row", async () => {
    const { db, CORTEX_DB_SCHEMA_VERSION } = await import("../src/db/schema");
    await db.open();
    expect(CORTEX_DB_SCHEMA_VERSION).toBe(6);
    expect(db.verno).toBe(6);
    for (const [name, n] of Object.entries(before)) {
      expect(await db.table(name).count(), name).toBe(n);
    }
    expect(before.documents).toBe(10);
    expect(before.chunks).toBe(30);
    expect(before.conversations).toBe(2);
  });

  it("keeps embeddings and reads every old chunk as kind 'text'", async () => {
    const { db, chunkKind } = await import("../src/db/schema");
    const chunks = await db.chunks.toArray();
    expect(chunks.every((c) => chunkKind(c) === "text")).toBe(true);
    expect(chunks.every((c) => c.embedding?.length === 384)).toBe(true);
    expect(chunks[0].embedding).toEqual(EMB);
  });

  it("creates the new stores empty", async () => {
    const { db } = await import("../src/db/schema");
    for (const name of ["people", "collections", "collectionItems", "highlights"]) {
      expect(db.tables.map((t) => t.name)).toContain(name);
      expect(await db.table(name).count(), name).toBe(0);
    }
  });

  it("old chats still load in order", async () => {
    const { db } = await import("../src/db/schema");
    const convs = await db.conversations.orderBy("updatedAt").toArray();
    expect(convs.map((c) => c.title)).toEqual(["Chat A", "Chat B"]);
    const msgs = await db.messages.where("conversationId").equals(convs[0].id!).sortBy("timestamp");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("replaceChunksForDocument rewrites only the given kinds", async () => {
    const { db, replaceChunksForDocument, chunkKind } = await import("../src/db/schema");
    const doc = await db.documents.orderBy("id").first();
    const id = doc!.id!;
    await db.chunks.add({ documentId: id, ord: 100, text: "transcript window", kind: "transcript", locator: { videoId: "abc", startSec: 0, endSec: 60 } });
    await db.chunks.add({ documentId: id, ord: 101, text: "saved quote", kind: "highlight", locator: { quote: "saved quote" } });
    await replaceChunksForDocument(
      id,
      [
        { ord: 0, text: "new text" },
        { ord: 1, text: "Header: value", kind: "table", locator: { tableIndex: 0, rowStart: 1, rowEnd: 12, caption: "c" } },
      ],
      { kinds: ["text", "table", "image"] }
    );
    const after = await db.chunks.where("documentId").equals(id).toArray();
    expect(after.map((c) => chunkKind(c)).sort()).toEqual(["highlight", "table", "text", "transcript"]);
    const table = after.find((c) => c.kind === "table")!;
    expect(table.locator).toEqual({ tableIndex: 0, rowStart: 1, rowEnd: 12, caption: "c" });
  });

  it("default replaceChunksForDocument (no kinds) replaces text chunks only", async () => {
    const { db, replaceChunksForDocument, chunkKind } = await import("../src/db/schema");
    const doc = await db.documents.orderBy("id").first();
    await replaceChunksForDocument(doc!.id!, [{ ord: 0, text: "only text" }]);
    const kinds = (await db.chunks.where("documentId").equals(doc!.id!).toArray()).map((c) => chunkKind(c)).sort();
    expect(kinds).toEqual(["highlight", "table", "text", "transcript"]);
  });
});
