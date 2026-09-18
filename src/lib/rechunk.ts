/**
 * Background re-chunk (Phase 3.4).
 *
 * Documents indexed before CHUNKING_VERSION (or with no version at all) are
 * rebuilt from their stored chunks: the original text is reconstructed by
 * dropping the overlap at each boundary (exact unless the page hit the old
 * per-page cap), re-chunked with the current profile, and the new chunks are
 * queued for embedding. Runs in small batches from an alarm so it never
 * competes with live indexing; each batch is independent, so it resumes after
 * a service worker restart without any cursor.
 */
import { db, replaceChunksForDocument } from "../db/schema";
import {
  chunkArticle,
  CHUNK_PROFILES,
  CHUNKING_VERSION,
  DEFAULT_CHUNK_PROFILE,
  reconstructTextFromChunks,
  type ChunkProfile,
} from "./chunking";

export const RECHUNK_BATCH_SIZE = 5;
export const RECHUNK_ALARM = "cortex-rechunk";
export const RECHUNK_ALARM_PERIOD_MIN = 2;

/** Profile that produced version N; used to undo the overlap when rebuilding text. */
function profileForVersion(version: number | undefined): ChunkProfile {
  if (version === 2) return CHUNK_PROFILES.compact;
  return CHUNK_PROFILES.wide; // 1.0.x pages carried no version
}

export async function findDocumentsNeedingRechunk(limit: number): Promise<number[]> {
  const docs = await db.documents.toArray();
  return docs
    .filter((d) => d.id != null && (d.chunkingVersion ?? 0) < CHUNKING_VERSION)
    .sort((a, b) => (b.lastVisitedAt ?? 0) - (a.lastVisitedAt ?? 0))
    .slice(0, limit)
    .map((d) => d.id as number);
}

export interface RechunkResult {
  ok: boolean;
  chunkIds: number[];
  reason?: string;
}

export async function rechunkDocument(documentId: number): Promise<RechunkResult> {
  const doc = await db.documents.get(documentId);
  if (!doc) return { ok: false, chunkIds: [], reason: "missing_document" };

  const existing = await db.chunks.where("documentId").equals(documentId).toArray();
  if (existing.length === 0) {
    // Nothing to rebuild from; mark current so the job does not retry forever.
    await db.documents.update(documentId, { chunkingVersion: CHUNKING_VERSION });
    return { ok: false, chunkIds: [], reason: "no_chunks" };
  }

  const text = reconstructTextFromChunks(
    existing.map((c) => ({ ord: c.ord, text: c.text })),
    profileForVersion(doc.chunkingVersion)
  );
  const parts = chunkArticle(text, CHUNK_PROFILES[DEFAULT_CHUNK_PROFILE]);
  const chunkIds = await replaceChunksForDocument(documentId, parts);
  return { ok: true, chunkIds };
}

export interface RechunkBatchDeps {
  /** Queue embeddings for freshly written chunk ids (service worker path). */
  queueEmbeddings: (chunkIds: number[], documentId: number) => Promise<void> | void;
  batchSize?: number;
}

export interface RechunkBatchResult {
  processed: number;
  remaining: number;
}

/** Processes up to `batchSize` stale documents; call again while `remaining > 0`. */
export async function runRechunkBatch(deps: RechunkBatchDeps): Promise<RechunkBatchResult> {
  const size = deps.batchSize ?? RECHUNK_BATCH_SIZE;
  const ids = await findDocumentsNeedingRechunk(size);
  let processed = 0;
  for (const id of ids) {
    const r = await rechunkDocument(id);
    processed += 1;
    if (r.ok && r.chunkIds.length) await deps.queueEmbeddings(r.chunkIds, id);
  }
  const remaining = (await findDocumentsNeedingRechunk(10_000)).length;
  return { processed, remaining };
}
