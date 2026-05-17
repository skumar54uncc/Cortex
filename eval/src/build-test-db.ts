import { chunkArticle } from "../../src/lib/chunking.js";
import {
  appendVisit,
  clearAllIndexedData,
  hostnameFromUrl,
  replaceChunksForDocument,
  setChunkEmbedding,
  upsertDocument,
} from "../../src/db/schema.js";
import { CORTEX_EMBED_MODEL_ID } from "../../src/shared/embed-model.js";
import type { CorpusPage } from "./types.js";
import { embedText } from "./embed-node.js";

function summaryFromText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

export interface BuildTestDbResult {
  documentCount: number;
  chunkCount: number;
}

export async function buildTestDb(pages: CorpusPage[]): Promise<BuildTestDbResult> {
  await clearAllIndexedData();

  const sorted = [...pages].sort((a, b) => a.id.localeCompare(b.id));
  let chunkTotal = 0;

  for (const page of sorted) {
    const visitedAt = Date.parse(page.captured_at);
    const domain = hostnameFromUrl(page.url);
    const summary = summaryFromText(page.extracted_text);

    const docId = await upsertDocument({
      url: page.url,
      domain,
      title: page.title,
      summary,
      lastVisitedAt: Number.isFinite(visitedAt) ? visitedAt : Date.now(),
    });

    const parts = chunkArticle(page.extracted_text).map((c) => ({
      ord: c.ord,
      text: c.text,
    }));

    const chunkIds = await replaceChunksForDocument(docId, parts);
    chunkTotal += chunkIds.length;

    for (let i = 0; i < chunkIds.length; i++) {
      const chunkId = chunkIds[i]!;
      const text = parts[i]?.text ?? "";
      const vec = await embedText(text);
      if (vec.length > 0) {
        await setChunkEmbedding(chunkId, vec, { modelId: CORTEX_EMBED_MODEL_ID });
      }
    }

    await appendVisit({
      url: page.url,
      title: page.title,
      hostname: domain,
      visitedAt: Number.isFinite(visitedAt) ? visitedAt : Date.now(),
      textLength: page.extracted_text.length,
    });
  }

  return { documentCount: sorted.length, chunkCount: chunkTotal };
}
