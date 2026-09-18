/**
 * Highlights and notes (Phase 5.3). "Save to Cortex" on selected text stores
 * a highlight row and a searchable `highlight` chunk (embedded like any other
 * chunk, ranked with a small boost). The caller (service worker) runs the
 * privacy gate before calling this.
 */
import { db, hostnameFromUrl, type ChunkLocator } from "../db/schema";
import { redactPII } from "./pii-filter";
import { safeHttpHttpsHref } from "./url-security";

export const HIGHLIGHT_LIMITS = { quote: 2000, note: 1000, title: 300 } as const;

export interface HighlightInput {
  url: string;
  title: string;
  quote: string;
  note?: string;
}

export interface SavedHighlight {
  highlightId: number;
  chunkId: number;
  documentId: number;
}

function clean(s: string | undefined, max: number): string {
  return redactPII(String(s ?? "").replace(/\s+/g, " ").trim()).redacted.slice(0, max);
}

export async function saveHighlight(input: HighlightInput, now: number = Date.now()): Promise<SavedHighlight> {
  const safe = safeHttpHttpsHref(input.url);
  if (!safe) throw new Error("Highlights can only be saved from web pages.");
  const u = new URL(safe);
  u.hash = "";
  const url = u.href;
  const quote = clean(input.quote, HIGHLIGHT_LIMITS.quote);
  if (!quote) throw new Error("Select some text to save.");
  const note = clean(input.note, HIGHLIGHT_LIMITS.note) || undefined;
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim().slice(0, HIGHLIGHT_LIMITS.title);

  return db.transaction("rw", [db.documents, db.chunks, db.highlights], async () => {
    let doc = await db.documents.where("url").equals(url).first();
    if (!doc) {
      const id = (await db.documents.add({
        url,
        domain: hostnameFromUrl(url),
        title: title || hostnameFromUrl(url),
        summary: quote.slice(0, 500),
        lastVisitedAt: now,
        visitCount: 1,
        importanceScore: 0.2,
      })) as number;
      doc = await db.documents.get(id);
    }
    const documentId = doc!.id as number;
    const locator: ChunkLocator = note ? { quote, note } : { quote };
    const chunkId = (await db.chunks.add({
      documentId,
      ord: 10_000 + ((await db.highlights.where("documentId").equals(documentId).count()) + 1),
      text: note ? `${quote}\n\nNote: ${note}` : quote,
      kind: "highlight",
      locator,
      embedState: "pending",
      embedUpdatedAt: now,
    })) as number;
    const highlightId = (await db.highlights.add({
      documentId,
      url,
      quote,
      ...(note ? { note } : {}),
      createdAt: now,
      chunkId,
    })) as number;
    return { highlightId, chunkId, documentId };
  });
}
