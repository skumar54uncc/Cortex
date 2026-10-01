import Dexie, { type EntityTable } from "dexie";

import { CORTEX_DB_SCHEMA_VERSION } from "../shared/cortex-constants";
import { CORTEX_EMBED_MODEL_ID } from "../shared/embed-model";
import { CHUNKING_VERSION } from "../lib/chunking";

export { CORTEX_DB_SCHEMA_VERSION };

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
  /**
   * Chunking profile version used for this document's chunks (Phase 3.2).
   * Missing on 1.0.x rows; the background re-chunk job upgrades them.
   */
  chunkingVersion?: number;
}

export type EmbedState = "pending" | "embedded" | "failed" | "skipped";

/** Where a chunk came from (release 1.2.0). Missing on 1.0.x rows: read as "text". */
export type ChunkKind = "text" | "transcript" | "table" | "image" | "pdf" | "highlight";

export const CHUNK_KINDS: readonly ChunkKind[] = ["text", "transcript", "table", "image", "pdf", "highlight"];

/** Kind-specific position of a chunk inside its source (serializable). */
export type ChunkLocator =
  | { videoId: string; startSec: number; endSec: number; /** Title, channel and description, not captions. */ meta?: boolean }
  | { tableIndex: number; rowStart: number; rowEnd: number; caption: string }
  | { page: number }
  | { images: { src: string; alt: string }[] }
  | { quote: string; note?: string };

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
  kind?: ChunkKind;
  locator?: ChunkLocator;
}

/** Read-time default: 1.0.x chunks have no kind and are plain page text. */
export function chunkKind(c: Pick<ChunkRecord, "kind">): ChunkKind {
  return c.kind ?? "text";
}

/** One experience row on a profile (release 1.2.x). */
export interface PersonRole {
  title: string;
  company: string;
}

/**
 * LinkedIn profile or company seen by the user (Phase 5.1).
 * Everything after visitCount is profile detail added in 1.2.x: optional, so
 * rows written by 1.2.0 still read, and indexed only through a table scan in
 * lib/people.ts (no new Dexie version, no new index).
 */
export interface PersonRecord {
  id?: number;
  kind: "person" | "company";
  name: string;
  headline: string;
  company: string;
  profileUrl: string;
  firstSeen: number;
  lastSeen: number;
  visitCount: number;
  location?: string;
  /** Trimmed about/summary text, capped at 600 characters. */
  about?: string;
  /** Current role title. */
  roleTitle?: string;
  /** Earlier roles, newest first, at most 5. */
  pastRoles?: PersonRole[];
  /** School plus degree lines, at most 3. */
  education?: string[];
  /** "1st", "2nd" or "3rd". */
  connectionDegree?: string;
  connectionCount?: number;
  /** Company pages only. */
  industry?: string;
  companySize?: string;
  tagline?: string;
  /** LinkedIn CDN photo, when the profile card had one. */
  photoUrl?: string;
  /** About, experience and education, for search. Not shown on the card. */
  profileText?: string;
}

export interface CollectionRecord {
  id?: number;
  name: string;
  createdAt: number;
}

export interface CollectionItemRecord {
  id?: number;
  collectionId: number;
  documentId: number;
  addedAt: number;
}

export interface HighlightRecord {
  id?: number;
  documentId: number;
  url: string;
  quote: string;
  note?: string;
  createdAt: number;
  /** The highlight chunk that makes it searchable. */
  chunkId?: number;
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
  people!: EntityTable<PersonRecord, "id">;
  collections!: EntityTable<CollectionRecord, "id">;
  collectionItems!: EntityTable<CollectionItemRecord, "id">;
  highlights!: EntityTable<HighlightRecord, "id">;

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
    // Release 1.2.0: the only schema bump. New stores and a kind index; no
    // row rewrite (old chunks read as "text" through chunkKind()).
    this.version(6).stores({
      pages: "++id, url, visitedAt",
      visitLog: "++id, visitedAt, hostname, url",
      documents: "++id, url, domain, lastVisitedAt",
      chunks: "++id, documentId, ord, kind",
      conversations: "++id, createdAt, updatedAt, title",
      messages: "++id, conversationId, timestamp",
      digestCache: "range, generatedAt",
      people: "++id, &profileUrl, lastSeen, company",
      collections: "++id, &name, createdAt",
      collectionItems: "++id, collectionId, documentId, &[collectionId+documentId], addedAt",
      highlights: "++id, documentId, url, createdAt",
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

export interface NewChunk {
  ord: number;
  text: string;
  kind?: ChunkKind;
  locator?: ChunkLocator;
}

/**
 * Replaces the document's chunks of the given kinds (default: text only) and
 * leaves other kinds alone, so re-indexing a page keeps its transcript and
 * highlight chunks.
 */
export async function replaceChunksForDocument(
  documentId: number,
  chunks: NewChunk[],
  opts: { kinds?: readonly ChunkKind[] } = {}
): Promise<number[]> {
  const kinds = new Set<ChunkKind>(opts.kinds ?? ["text"]);
  await db.chunks
    .where("documentId")
    .equals(documentId)
    .filter((c) => kinds.has(chunkKind(c)))
    .delete();
  const ids: number[] = [];
  for (const c of chunks) {
    const kind = c.kind ?? "text";
    const id = await db.chunks.add({
      documentId,
      ord: c.ord,
      text: c.text,
      embedState: "pending",
      embedUpdatedAt: Date.now(),
      ...(kind !== "text" ? { kind } : {}),
      ...(c.locator ? { locator: c.locator } : {}),
    });
    ids.push(id as number);
  }
  await db.documents.update(documentId, { chunkingVersion: CHUNKING_VERSION });
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
      db.pages,
      db.documents,
      db.chunks,
      db.visitLog,
      db.conversations,
      db.messages,
      db.digestCache,
      db.people,
      db.collections,
      db.collectionItems,
      db.highlights,
    ],
    async () => {
      await db.pages.clear();
      await db.people.clear();
      await db.collections.clear();
      await db.collectionItems.clear();
      await db.highlights.clear();
      await db.documents.clear();
      await db.chunks.clear();
      await db.visitLog.clear();
      await db.conversations.clear();
      await db.messages.clear();
      await db.digestCache.clear();
    }
  );
}
