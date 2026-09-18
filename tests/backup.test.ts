import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { db, clearAllIndexedData } from "../src/db/schema";
import {
  collectBackup,
  validateBackup,
  restoreBackup,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BACKUP_STORES,
  type CortexBackup,
} from "../src/lib/export/backup";

const T = Date.parse("2026-09-01T10:00:00Z");
const vec = Array.from({ length: 384 }, (_, i) => i / 384);

async function seed(): Promise<void> {
  const a = (await db.documents.add({
    url: "https://a.test/aurora",
    domain: "a.test",
    title: "Aurora notes",
    summary: "Magnetometer drift",
    lastVisitedAt: T,
    visitCount: 3,
    importanceScore: 0.4,
    chunkingVersion: 2,
  })) as number;
  const b = (await db.documents.add({
    url: "https://b.test/bank",
    domain: "b.test",
    title: "Bank statement",
    summary: "",
    lastVisitedAt: T,
    visitCount: 1,
    importanceScore: 0.1,
  })) as number;
  const [c1] = (await db.chunks.bulkAdd(
    [
      { documentId: a, ord: 0, text: "Magnetometer drift was 4 nT per hour.", embedding: vec, embedState: "embedded", embedModelId: "m" },
      { documentId: a, ord: 4000, text: "Fluxgate recalibrated", kind: "pdf", locator: { page: 2 }, embedding: vec, embedState: "embedded" },
      { documentId: b, ord: 0, text: "Balance 1,200", embedding: vec, embedState: "embedded" },
    ],
    { allKeys: true }
  )) as number[];
  const hChunk = (await db.chunks.add({
    documentId: a,
    ord: 9000,
    text: "4 nT per hour",
    kind: "highlight",
    locator: { quote: "4 nT per hour", note: "check" },
    embedding: vec,
  })) as number;
  await db.highlights.add({ documentId: a, url: "https://a.test/aurora", quote: "4 nT per hour", note: "check", createdAt: T, chunkId: hChunk });
  const col = (await db.collections.add({ name: "Research", createdAt: T })) as number;
  await db.collectionItems.add({ collectionId: col, documentId: a, addedAt: T });
  const conv = (await db.conversations.add({ createdAt: T, updatedAt: T, title: "Drift?" })) as number;
  await db.messages.bulkAdd([
    { conversationId: conv, role: "user", content: "How fast is the drift?", timestamp: T },
    {
      conversationId: conv,
      role: "assistant",
      content: "4 nT per hour [1].",
      timestamp: T + 1,
      provider: "nano",
      citedChunksJson: JSON.stringify([{ chunkId: c1, documentId: a, url: "https://a.test/aurora", title: "Aurora notes" }]),
    },
  ]);
  await db.people.add({
    kind: "person",
    name: "Ada Field",
    headline: "Glaciologist",
    company: "Polar Lab",
    profileUrl: "https://www.linkedin.com/in/ada-field/",
    firstSeen: T,
    lastSeen: T,
    visitCount: 2,
  });
  await db.visitLog.bulkAdd([
    { url: "https://a.test/aurora", title: "Aurora notes", hostname: "a.test", visitedAt: T, textLength: 100 },
    { url: "https://b.test/bank", title: "Bank statement", hostname: "b.test", visitedAt: T, textLength: 10 },
  ]);
}

/** Library content without ids, with relations resolved to natural keys. */
async function snapshot() {
  const docs = await db.documents.toArray();
  const urlOf = new Map(docs.map((d) => [d.id!, d.url]));
  const chunks = await db.chunks.toArray();
  const textOf = new Map(chunks.map((c) => [c.id!, c.text]));
  const cols = await db.collections.toArray();
  const colName = new Map(cols.map((c) => [c.id!, c.name]));
  const convs = await db.conversations.toArray();
  const convTitle = new Map(convs.map((c) => [c.id!, c.title]));
  return {
    documents: docs.map(({ id: _id, ...d }) => d).sort((x, y) => x.url.localeCompare(y.url)),
    chunks: chunks
      .map((c) => ({ url: urlOf.get(c.documentId), ord: c.ord, text: c.text, kind: c.kind, locator: c.locator }))
      .sort((x, y) => `${x.url}${x.ord}`.localeCompare(`${y.url}${y.ord}`)),
    highlights: (await db.highlights.toArray()).map((h) => ({
      url: urlOf.get(h.documentId),
      quote: h.quote,
      note: h.note,
      chunkText: h.chunkId != null ? textOf.get(h.chunkId) : undefined,
    })),
    collectionItems: (await db.collectionItems.toArray()).map((i) => ({ col: colName.get(i.collectionId), url: urlOf.get(i.documentId) })),
    messages: (await db.messages.toArray()).map((m) => ({
      conv: convTitle.get(m.conversationId),
      role: m.role,
      content: m.content,
      cited: m.citedChunksJson
        ? (JSON.parse(m.citedChunksJson) as { chunkId: number; documentId: number }[]).map((c) => ({
            text: textOf.get(c.chunkId),
            url: urlOf.get(c.documentId),
          }))
        : undefined,
    })),
    people: (await db.people.toArray()).map(({ id: _id, ...p }) => p),
    visits: (await db.visitLog.toArray()).map(({ id: _id, ...v }) => v),
  };
}

const allowAll = async () => true;

beforeEach(async () => {
  await clearAllIndexedData();
});

describe("collectBackup", () => {
  it("writes every library store, drops embeddings, and never carries settings or the Gemini key", async () => {
    await seed();
    const backup = await collectBackup(T + 5);
    expect(backup).toMatchObject({ format: BACKUP_FORMAT, version: BACKUP_VERSION, schemaVersion: 6, exportedAt: T + 5 });
    expect(Object.keys(backup.stores).sort()).toEqual([...BACKUP_STORES].sort());
    expect(backup.stores.documents).toHaveLength(2);
    expect(backup.stores.chunks).toHaveLength(4);
    const json = JSON.stringify(backup);
    expect(json).not.toContain("embedding");
    expect(json).not.toContain("embedState");
    expect(json).not.toMatch(/geminiApiKey|cortex_user_settings/);
  });
});

describe("restoreBackup", () => {
  it("round trip: export, wipe, restore gives the same library; chunks come back pending for re-embedding", async () => {
    await seed();
    const before = await snapshot();
    const backup = JSON.parse(JSON.stringify(await collectBackup(T))) as unknown;
    await clearAllIndexedData();
    const v = validateBackup(backup);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const res = await restoreBackup(v.backup, { mode: "replace", allowUrl: allowAll });
    expect(res.added).toMatchObject({ documents: 2, chunks: 4, highlights: 1, collections: 1, collectionItems: 1, conversations: 1, messages: 2, people: 1, visitLog: 2 });
    expect(await snapshot()).toEqual(before);
    const chunks = await db.chunks.toArray();
    expect(chunks.every((c) => c.embedState === "pending" && c.embedding === undefined)).toBe(true);
    expect(res.chunkIdsToEmbed.sort()).toEqual(chunks.map((c) => c.id!).sort());
  });

  it("merge: pages already in the library are kept, nothing is duplicated, and a second merge adds nothing", async () => {
    await seed();
    const backup = validateBackup(JSON.parse(JSON.stringify(await collectBackup(T))));
    if (!backup.ok) throw new Error(backup.error);
    const before = await snapshot();
    const first = await restoreBackup(backup.backup, { mode: "merge", allowUrl: allowAll });
    expect(Object.values(first.added).every((n) => n === 0)).toBe(true);
    expect(await snapshot()).toEqual(before);

    await db.documents.where("url").equals("https://b.test/bank").delete();
    const second = await restoreBackup(backup.backup, { mode: "merge", allowUrl: allowAll });
    expect(second.added.documents).toBe(1);
    expect(await db.documents.count()).toBe(2);
  });

  it("applies the privacy gate: blocked or sensitive pages are not restored, with their chunks and visits", async () => {
    await seed();
    const backup = validateBackup(JSON.parse(JSON.stringify(await collectBackup(T))));
    if (!backup.ok) throw new Error(backup.error);
    await clearAllIndexedData();
    const res = await restoreBackup(backup.backup, {
      mode: "replace",
      allowUrl: async (url) => !url.includes("b.test"),
    });
    expect(res.blocked).toBe(1);
    expect((await db.documents.toArray()).map((d) => d.url)).toEqual(["https://a.test/aurora"]);
    expect((await db.chunks.toArray()).some((c) => c.text.includes("Balance"))).toBe(false);
    expect((await db.visitLog.toArray()).map((v) => v.hostname)).toEqual(["a.test"]);
  });
});

describe("validateBackup", () => {
  async function valid(): Promise<CortexBackup> {
    await seed();
    return JSON.parse(JSON.stringify(await collectBackup(T))) as CortexBackup;
  }

  it("rejects files that are not a Cortex backup of this version", async () => {
    const b = await valid();
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup({ ...b, format: "other" }).ok).toBe(false);
    expect(validateBackup({ ...b, version: 2 }).ok).toBe(false);
    expect(validateBackup({ ...b, stores: { ...b.stores, documents: "x" } }).ok).toBe(false);
  });

  it("rejects bad rows: script URLs, dangling references, bad kinds and locators, oversized text", async () => {
    const b = await valid();
    const docId = b.stores.documents[0]!.id;
    const bad: [string, (x: CortexBackup) => void][] = [
      ["javascript URL", (x) => (x.stores.documents[0]!.url = "javascript:alert(1)")],
      ["dangling chunk", (x) => (x.stores.chunks[0]!.documentId = 999_999)],
      ["bad kind", (x) => ((x.stores.chunks[0] as { kind?: string }).kind = "exe")],
      ["bad locator", (x) => (x.stores.chunks[1]!.locator = { page: "two" } as never)],
      ["huge text", (x) => (x.stores.chunks[0]!.text = "a".repeat(200_001))],
      ["bad role", (x) => ((x.stores.messages[0] as { role: string }).role = "system")],
      ["dangling message", (x) => (x.stores.messages[0]!.conversationId = 999_999)],
      ["dangling item", (x) => (x.stores.collectionItems[0]!.documentId = 999_999)],
      ["duplicate doc id", (x) => x.stores.documents.push({ ...x.stores.documents[0]!, id: docId, url: "https://c.test/" })],
    ];
    for (const [label, mutate] of bad) {
      const copy = JSON.parse(JSON.stringify(b)) as CortexBackup;
      mutate(copy);
      const r = validateBackup(copy);
      expect(r.ok, label).toBe(false);
    }
  });

  it("reports counts for the confirmation step", async () => {
    const r = validateBackup(await valid());
    expect(r.ok && r.counts).toMatchObject({ documents: 2, chunks: 4, conversations: 1, people: 1, collections: 1, highlights: 1 });
  });
});
