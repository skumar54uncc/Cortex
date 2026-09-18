import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db/schema";
import {
  createCollection,
  listCollections,
  deleteCollection,
  addDocumentToCollection,
  removeDocumentFromCollection,
  documentIdsInCollection,
  COLLECTION_NAME_MAX,
} from "../src/lib/collections";

async function doc(url: string): Promise<number> {
  return (await db.documents.add({
    url,
    domain: new URL(url).hostname,
    title: url,
    summary: "",
    lastVisitedAt: 1,
    visitCount: 1,
    importanceScore: 0.1,
  })) as number;
}

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
});

describe("collections", () => {
  it("creates trimmed, unique (case-insensitive) names up to the length limit", async () => {
    const id = await createCollection("  Job search  ", 5);
    expect((await db.collections.get(id))?.name).toBe("Job search");
    await expect(createCollection("job SEARCH")).rejects.toThrow(/already exists/i);
    await expect(createCollection("   ")).rejects.toThrow();
    const long = await createCollection("x".repeat(200));
    expect((await db.collections.get(long))!.name.length).toBe(COLLECTION_NAME_MAX);
  });

  it("adds documents idempotently, lists counts, and scopes document ids", async () => {
    const a = await doc("https://a.test/");
    const b = await doc("https://b.test/");
    const jobs = await createCollection("Job search");
    const reading = await createCollection("Reading");
    await addDocumentToCollection(jobs, a);
    await addDocumentToCollection(jobs, a);
    await addDocumentToCollection(jobs, b);
    await addDocumentToCollection(reading, b);
    expect(await db.collectionItems.count()).toBe(3);
    const list = await listCollections();
    expect(list.map((c) => [c.name, c.count])).toEqual([
      ["Job search", 2],
      ["Reading", 1],
    ]);
    expect([...(await documentIdsInCollection(reading))]).toEqual([b]);
    await removeDocumentFromCollection(jobs, a);
    expect([...(await documentIdsInCollection(jobs))]).toEqual([b]);
  });

  it("rejects unknown collections and documents", async () => {
    const a = await doc("https://a.test/");
    await expect(addDocumentToCollection(999, a)).rejects.toThrow();
    const c = await createCollection("C");
    await expect(addDocumentToCollection(c, 999)).rejects.toThrow();
  });

  it("deleting a collection removes its items but never the pages", async () => {
    const a = await doc("https://a.test/");
    const c = await createCollection("Temp");
    await addDocumentToCollection(c, a);
    await deleteCollection(c);
    expect(await db.collections.count()).toBe(0);
    expect(await db.collectionItems.count()).toBe(0);
    expect(await db.documents.count()).toBe(1);
  });
});

import { addPageToCollection } from "../src/lib/collections";

describe("addPageToCollection", () => {
  it("uses the indexed document for the URL (hash ignored), or creates a minimal one", async () => {
    const existing = await doc("https://a.test/page");
    const c = await createCollection("Jobs");
    const r1 = await addPageToCollection(c, "https://a.test/page#top", "A");
    expect(r1).toEqual({ documentId: existing, created: false });
    const r2 = await addPageToCollection(c, "https://new.test/x", "New page");
    expect(r2.created).toBe(true);
    expect((await db.documents.get(r2.documentId))?.title).toBe("New page");
    expect([...(await documentIdsInCollection(c))].sort()).toEqual([existing, r2.documentId].sort());
  });

  it("refuses non-web URLs", async () => {
    const c = await createCollection("Jobs");
    await expect(addPageToCollection(c, "chrome://settings", "x")).rejects.toThrow();
  });
});
