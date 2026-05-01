import { db } from "../db/schema";
import { STORAGE_LIMITS } from "./limits";

/** Leave room for one worst-case index (many chunks) before hitting MAX_CHUNKS. */
const CHUNK_HEADROOM = STORAGE_LIMITS.MAX_CHUNKS_PER_DOCUMENT + 8;

const MAX_EVICT_STEPS = 50_000;

function maxChunksAllowed(): number {
  return STORAGE_LIMITS.MAX_CHUNKS - CHUNK_HEADROOM;
}

/**
 * Delete oldest visited documents (by `lastVisitedAt`) until we're under hard caps.
 * Safe to call before upserting a new page.
 */
export async function ensureIndexingHeadroom(): Promise<{
  documentsRemoved: number;
  ok: boolean;
}> {
  let documentsRemoved = 0;
  let steps = 0;

  const budget = maxChunksAllowed();

  while (steps++ < MAX_EVICT_STEPS) {
    const [docCount, chunkCount] = await Promise.all([
      db.documents.count(),
      db.chunks.count(),
    ]);

    const docsOver = docCount >= STORAGE_LIMITS.MAX_DOCUMENTS;
    const chunksOver = chunkCount > budget;

    if (!docsOver && !chunksOver) break;

    const victim = await db.documents.orderBy("lastVisitedAt").first();
    if (!victim?.id) {
      return { documentsRemoved, ok: false };
    }

    await db.chunks.where("documentId").equals(victim.id).delete();
    await db.documents.delete(victim.id);
    documentsRemoved++;
  }

  const [finalDocs, finalChunks] = await Promise.all([
    db.documents.count(),
    db.chunks.count(),
  ]);

  const ok =
    finalDocs < STORAGE_LIMITS.MAX_DOCUMENTS &&
    finalChunks <= maxChunksAllowed();

  return { documentsRemoved, ok };
}
