import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { db, type DocumentRecord } from "../src/db/schema";
import {
  applyRetention,
  forgetSite,
  forgetSince,
  forgetAll,
  HANDLED_TABLES,
  FORGET_WINDOWS_MS,
} from "../src/lib/data-controls";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-18T12:00:00Z");

async function addDoc(url: string, lastVisitedAt: number): Promise<number> {
  const doc: DocumentRecord = {
    url,
    domain: new URL(url).hostname,
    title: url,
    summary: "s",
    lastVisitedAt,
    visitCount: 1,
    importanceScore: 0.1,
  };
  const id = (await db.documents.add(doc)) as number;
  await db.chunks.bulkAdd([
    { documentId: id, ord: 0, text: `${url} chunk a` },
    { documentId: id, ord: 1, text: `${url} chunk b` },
  ]);
  await db.visitLog.add({
    url,
    title: url,
    hostname: new URL(url).hostname,
    visitedAt: lastVisitedAt,
    textLength: 10,
  });
  return id;
}

async function addChat(updatedAt: number, citedUrls: string[]): Promise<number> {
  const id = (await db.conversations.add({ createdAt: updatedAt, updatedAt, title: "chat" })) as number;
  await db.messages.add({ conversationId: id, role: "user", content: "q", timestamp: updatedAt });
  await db.messages.add({
    conversationId: id,
    role: "assistant",
    content: "a",
    timestamp: updatedAt,
    citedChunksJson: JSON.stringify(
      citedUrls.map((url, i) => ({ chunkId: i + 1, documentId: 1, url, title: url }))
    ),
  });
  return id;
}

async function counts() {
  return {
    documents: await db.documents.count(),
    chunks: await db.chunks.count(),
    visitLog: await db.visitLog.count(),
    conversations: await db.conversations.count(),
    messages: await db.messages.count(),
    digestCache: await db.digestCache.count(),
    pages: await db.pages.count(),
  };
}

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
});

describe("store coverage", () => {
  it("every IndexedDB table is handled by retention and forget (new stores must be added)", () => {
    const tables = db.tables.map((t) => t.name).sort();
    expect([...HANDLED_TABLES].sort()).toEqual(tables);
  });
});

describe("applyRetention", () => {
  it("is a no-op when retention is off (0)", async () => {
    await addDoc("https://old.test/a", NOW - 400 * DAY);
    const r = await applyRetention(0, NOW);
    expect(r.documents).toBe(0);
    expect((await counts()).documents).toBe(1);
  });

  it("deletes documents, their chunks, visits, old chats and legacy pages older than N days; keeps newer data", async () => {
    await addDoc("https://old.test/a", NOW - 40 * DAY);
    await addDoc("https://new.test/b", NOW - 5 * DAY);
    await addChat(NOW - 45 * DAY, ["https://old.test/a"]);
    await addChat(NOW - 1 * DAY, ["https://new.test/b"]);
    await db.digestCache.put({ range: "last_7_days", generatedAt: NOW, resultJson: "{}" });
    await db.pages.add({ url: "https://legacy.test/", title: "l", visitedAt: NOW - 90 * DAY, text: "t", summary: "" });

    const r = await applyRetention(30, NOW);
    expect(r).toMatchObject({ documents: 1, chunks: 2, visits: 1, conversations: 1, pages: 1 });
    const c = await counts();
    expect(c).toMatchObject({ documents: 1, chunks: 2, visitLog: 1, conversations: 1, messages: 2, pages: 0 });
    // Digests summarize deleted pages: always cleared when anything was removed.
    expect(c.digestCache).toBe(0);
    const left = await db.documents.toArray();
    expect(left[0].url).toBe("https://new.test/b");
  });

  it("boundary: a page exactly N days old is kept; one millisecond older is deleted", async () => {
    await addDoc("https://edge.test/keep", NOW - 30 * DAY);
    await addDoc("https://edge.test/drop", NOW - 30 * DAY - 1);
    await applyRetention(30, NOW);
    expect((await db.documents.toArray()).map((d) => d.url)).toEqual(["https://edge.test/keep"]);
  });
});

describe("forgetSite", () => {
  it("removes the site and its subdomains from documents, chunks and visits, and answers that cite it", async () => {
    await addDoc("https://example.com/a", NOW);
    await addDoc("https://docs.example.com/b", NOW);
    await addDoc("https://notexample.com/c", NOW);
    await addDoc("https://other.test/d", NOW);
    const chatA = await addChat(NOW, ["https://docs.example.com/b"]);
    await addChat(NOW, ["https://other.test/d"]);
    await db.digestCache.put({ range: "today", generatedAt: NOW, resultJson: "{}" });

    const r = await forgetSite("Example.com");
    expect(r.documents).toBe(2);
    const urls = (await db.documents.toArray()).map((d) => d.url).sort();
    expect(urls).toEqual(["https://notexample.com/c", "https://other.test/d"]);
    expect(await db.chunks.count()).toBe(4);
    expect((await db.visitLog.toArray()).map((v) => v.hostname).sort()).toEqual(["notexample.com", "other.test"]);
    // The answer that cited the site is removed; the user's question stays.
    const msgsA = await db.messages.where("conversationId").equals(chatA).toArray();
    expect(msgsA.map((m) => m.role)).toEqual(["user"]);
    expect(await db.messages.count()).toBe(3);
    expect(await db.digestCache.count()).toBe(0);
  });

  it("rejects an empty or invalid hostname without deleting anything", async () => {
    await addDoc("https://example.com/a", NOW);
    await expect(forgetSite("")).rejects.toThrow();
    await expect(forgetSite("   ")).rejects.toThrow();
    expect(await db.documents.count()).toBe(1);
  });
});

describe("forgetSince", () => {
  it("forget last hour removes pages visited, visits logged and chat messages written in the window", async () => {
    await addDoc("https://recent.test/a", NOW - 10 * 60_000);
    await addDoc("https://older.test/b", NOW - 3 * 3_600_000);
    const recentChat = await addChat(NOW - 5 * 60_000, []);
    const olderChat = await addChat(NOW - 5 * 3_600_000, []);
    const r = await forgetSince(NOW - FORGET_WINDOWS_MS.hour);
    expect(r.documents).toBe(1);
    expect((await db.documents.toArray()).map((d) => d.url)).toEqual(["https://older.test/b"]);
    expect(await db.visitLog.count()).toBe(1);
    expect(await db.conversations.get(recentChat)).toBeUndefined();
    expect(await db.conversations.get(olderChat)).toBeDefined();
    expect(await db.messages.count()).toBe(2);
  });

  it("exposes hour and day windows", () => {
    expect(FORGET_WINDOWS_MS.hour).toBe(3_600_000);
    expect(FORGET_WINDOWS_MS.day).toBe(DAY);
  });
});

describe("forgetAll", () => {
  it("empties every table, including the legacy pages table", async () => {
    await addDoc("https://a.test/", NOW);
    await addChat(NOW, []);
    await db.digestCache.put({ range: "today", generatedAt: NOW, resultJson: "{}" });
    await db.pages.add({ url: "https://legacy.test/", title: "l", visitedAt: NOW, text: "t", summary: "" });
    await forgetAll();
    for (const t of db.tables) expect(await t.count()).toBe(0);
  });
});
