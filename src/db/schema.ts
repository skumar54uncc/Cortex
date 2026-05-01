import Dexie, { type EntityTable } from "dexie";

import { CORTEX_EMBED_MODEL_ID } from "../shared/embed-model";

/** Legacy — migrated into documents + chunks in v3 */
export interface IndexedPage {
  id?: number;
  url: string;
  title: string;
  visitedAt: number;
  text: string;
  summary: string;
  embedding?: number[];
}

export interface DocumentRecord {
  id?: number;
  url: string;
  domain: string;
  title: string;
  summary: string;
  lastVisitedAt: number;
  visitCount: number;
  /** 0–1 roll-up for ranking (visits, length — viewport scoring can refine later) */
  importanceScore: number;
}

export type EmbedState = "pending" | "embedded" | "failed" | "skipped";

export interface ChunkRecord {
  id?: number;
  documentId: number;
  ord: number;
  text: string;
  /** L2-normalized embedding (384-d for MiniLM) */
  embedding?: number[];
  /** Embedding lifecycle (optional on legacy rows) */
  embedState?: EmbedState;
  embedModelId?: string;
  embedUpdatedAt?: number;
}

/** Append-only timeline */
export interface VisitLogEntry {
  id?: number;
  url: string;
  title: string;
  hostname: string;
  visitedAt: number;
  textLength: number;
}

export interface ConversationRecord {
  id?: number;
  createdAt: number;
  updatedAt: number;
  title: string;
}

export interface ConversationMessageRecord {
  id?: number;
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  citedChunksJson?: string;
  provider?: "nano" | "cloud";
}

export interface DigestCacheRecord {
  range: string;
  generatedAt: number;
  /** Structured digest payload */
  resultJson: string;
}

export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export class CortexDB extends Dexie {
  /** Legacy table — kept after migration for Dexie version chain */
  pages!: EntityTable<IndexedPage, "id">;
  visitLog!: EntityTable<VisitLogEntry, "id">;
  documents!: EntityTable<DocumentRecord, "id">;
  chunks!: EntityTable<ChunkRecord, "id">;
  conversations!: EntityTable<ConversationRecord, "id">;
  messages!: EntityTable<ConversationMessageRecord, "id">;
  digestCache!: EntityTable<DigestCacheRecord, "range">;

  constructor() {
    super("cortex-db");
    this.version(1).stores({
      pages: "++id, url, visitedAt",
    });
    this.version(2).stores({
      pages: "++id, url, visitedAt",
      visitLog: "++id, visitedAt, hostname, url",
    });
    this.version(3)
      .stores({
        pages: "++id, url, visitedAt",
        visitLog: "++id, visitedAt, hostname, url",
        documents: "++id, url, domain, lastVisitedAt",
        chunks: "++id, documentId, ord",
      })
      .upgrade(async (tx) => {
        const pagesTable = tx.table("pages") as Dexie.Table<IndexedPage, number>;
        const docsTable = tx.table("documents") as Dexie.Table<DocumentRecord, number>;
        const chunksTable = tx.table("chunks") as Dexie.Table<ChunkRecord, number>;

        const all = await pagesTable.toArray();
        const byUrl = new Map<string, IndexedPage>();
        for (const p of all) {
          const prev = byUrl.get(p.url);
          if (!prev || (p.visitedAt ?? 0) >= (prev.visitedAt ?? 0)) {
            byUrl.set(p.url, p);
          }
        }

        for (const p of byUrl.values()) {
          const domain = hostnameFromUrl(p.url);
          const docId = await docsTable.add({
            url: p.url,
            domain,
            title: p.title,
            summary: p.summary,
            lastVisitedAt: p.visitedAt,
            visitCount: 1,
            importanceScore: Math.min(1, 0.15),
          });

          await chunksTable.add({
            documentId: docId as number,
            ord: 0,
            text: p.text,
            embedding: p.embedding,
          });
        }
      });
    this.version(4).stores({
      pages: "++id, url, visitedAt",
      visitLog: "++id, visitedAt, hostname, url",
      documents: "++id, url, domain, lastVisitedAt",
      chunks: "++id, documentId, ord",
    });
    this.version(5).stores({
      pages: "++id, url, visitedAt",
      visitLog: "++id, visitedAt, hostname, url",
      documents: "++id, url, domain, lastVisitedAt",
      chunks: "++id, documentId, ord",
      conversations: "++id, createdAt, updatedAt, title",
      messages: "++id, conversationId, timestamp",
      digestCache: "range, generatedAt",
    });
  }
}

export const db = new CortexDB();

const MAX_VISIT_LOG = 50_000;

export async function upsertDocument(rec: {
  url: string;
  domain: string;
  title: string;
  summary: string;
  lastVisitedAt: number;
}): Promise<number> {
  const existing = await db.documents.where("url").equals(rec.url).first();
  const mergedTitle = rec.title || existing?.title || "Untitled";

  if (existing?.id != null) {
    const vc = (existing.visitCount ?? 1) + 1;
    const imp = Math.min(
      1,
      (existing.importanceScore ?? 0) +
        0.07 +
        Math.min(0.15, rec.summary.length / 25_000)
    );
    await db.documents.update(existing.id, {
      title: mergedTitle,
      summary: rec.summary,
      lastVisitedAt: rec.lastVisitedAt,
      domain: rec.domain || existing.domain,
      visitCount: vc,
      importanceScore: imp,
    });
    return existing.id;
  }

  return db.documents.add({
    url: rec.url,
    domain: rec.domain,
    title: mergedTitle,
    summary: rec.summary,
    lastVisitedAt: rec.lastVisitedAt,
    visitCount: 1,
    importanceScore: Math.min(1, 0.12),
  }) as Promise<number>;
}

export async function replaceChunksForDocument(
  documentId: number,
  chunks: { ord: number; text: string }[]
): Promise<number[]> {
  await db.chunks.where("documentId").equals(documentId).delete();
  const ids: number[] = [];
  for (const c of chunks) {
    const id = await db.chunks.add({
      documentId,
      ord: c.ord,
      text: c.text,
      embedState: "pending",
      embedUpdatedAt: Date.now(),
    });
    ids.push(id as number);
  }
  return ids;
}

export async function setChunkEmbedding(
  chunkId: number,
  embedding: number[],
  opts?: { modelId?: string }
): Promise<void> {
  await db.chunks.update(chunkId, {
    embedding,
    embedState: "embedded",
    embedModelId: opts?.modelId ?? CORTEX_EMBED_MODEL_ID,
    embedUpdatedAt: Date.now(),
  });
}

export async function markChunkEmbedFailed(chunkId: number): Promise<void> {
  await db.chunks.update(chunkId, {
    embedState: "failed",
    embedUpdatedAt: Date.now(),
  });
}

export async function appendVisit(entry: Omit<VisitLogEntry, "id">): Promise<void> {
  await db.visitLog.add(entry);
  const count = await db.visitLog.count();
  if (count <= MAX_VISIT_LOG) return;

  const trim = count - MAX_VISIT_LOG;
  const ids = await db.visitLog.orderBy("visitedAt").limit(trim).keys();
  await db.visitLog.bulkDelete(ids as number[]);
}

export async function getRecentVisits(limit: number): Promise<VisitLogEntry[]> {
  return db.visitLog.orderBy("visitedAt").reverse().limit(limit).toArray();
}

/** URLs that had a logged visit in [start, end] (local timestamps). */
export async function getUrlsVisitedBetween(
  start: number,
  end: number
): Promise<Set<string>> {
  const rows = await db.visitLog
    .where("visitedAt")
    .between(start, end, true, true)
    .toArray();
  return new Set(rows.map((r) => r.url));
}

export async function documentCount(): Promise<number> {
  return db.documents.count();
}

export async function chunkCount(): Promise<number> {
  return db.chunks.count();
}

/** Wipes indexed documents, chunks, and visit log — irreversible. */
export async function clearAllIndexedData(): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.documents,
      db.chunks,
      db.visitLog,
      db.conversations,
      db.messages,
      db.digestCache,
    ],
    async () => {
      await db.documents.clear();
      await db.chunks.clear();
      await db.visitLog.clear();
      await db.conversations.clear();
      await db.messages.clear();
      await db.digestCache.clear();
    }
  );
}
