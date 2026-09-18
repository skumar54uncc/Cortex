/**
 * "Seen this before" (Phase 5.5). Off by default. After a page is indexed and
 * embedded, the most similar other page in the library is found locally; if
 * it is a strong match, a small dismissible chip links to it. Never on
 * sensitive sites, never twice for the same page on the same day.
 */
import { db } from "../db/schema";
import { cosineSimilarity } from "./similarity";

/** Cosine on MiniLM mean vectors; high so the chip is rare and relevant. */
export const RESURFACE_THRESHOLD = 0.82;
export const RESURFACE_SHOWN_KEY = "cortex_resurface_shown";
const SHOWN_MAX = 500;

export interface ResurfaceInput {
  enabled: boolean;
  similarity: number;
  currentUrl: string;
  matchUrl: string;
  sensitive: boolean;
  lastShownDay?: string;
  today: string;
}

function stripHash(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}

export function shouldResurface(i: ResurfaceInput): boolean {
  if (!i.enabled || i.sensitive) return false;
  if (!(i.similarity >= RESURFACE_THRESHOLD)) return false;
  if (stripHash(i.currentUrl) === stripHash(i.matchUrl)) return false;
  if (i.lastShownDay === i.today) return false;
  return true;
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Keeps today's entries only (the cap is per day), at most SHOWN_MAX. */
export function pruneShownMap(map: Record<string, string>, today: string): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [url, day] of Object.entries(map)) {
    if (day !== today) continue;
    out[url] = day;
    if (++n >= SHOWN_MAX) break;
  }
  return out;
}

export interface SimilarDocument {
  documentId: number;
  url: string;
  title: string;
  similarity: number;
}

function meanVector(vecs: number[][]): number[] | null {
  if (!vecs.length) return null;
  const dim = vecs[0]!.length;
  const out = new Array<number>(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) out[i] += v[i] ?? 0;
  const n = Math.hypot(...out) || 1;
  return out.map((x) => x / n);
}

/** Most similar other document by max chunk cosine to this page's mean vector. */
export async function findMostSimilarDocument(documentId: number): Promise<SimilarDocument | null> {
  const own = await db.chunks.where("documentId").equals(documentId).toArray();
  const q = meanVector(own.filter((c) => c.embedding?.length).map((c) => c.embedding!));
  if (!q) return null;
  let bestDoc = -1;
  let best = -Infinity;
  await db.chunks.each((c) => {
    if (c.documentId === documentId || !c.embedding?.length) return;
    const s = cosineSimilarity(q, c.embedding);
    if (s > best) {
      best = s;
      bestDoc = c.documentId;
    }
  });
  if (bestDoc < 0) return null;
  const doc = await db.documents.get(bestDoc);
  if (!doc) return null;
  return { documentId: bestDoc, url: doc.url, title: doc.title, similarity: best };
}
