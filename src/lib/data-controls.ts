/**
 * Retention (Phase 4.2) and forget controls (Phase 4.3).
 *
 * All deletes go through here so every IndexedDB store is covered. The
 * HANDLED_TABLES list is checked against the live schema by
 * tests/data-controls.test.ts: adding a store without handling it here fails
 * the build.
 *
 * Semantics:
 * - Pages: a document goes when its lastVisitedAt is in scope; its chunks go
 *   with it. Visits are matched by visitedAt / hostname.
 * - Chats: messages written in a time window are deleted (conversations left
 *   empty are removed). For a forgotten site, assistant answers that cite it
 *   are deleted; the user's question stays.
 * - Digests summarize many pages, so the digest cache is cleared whenever
 *   anything is removed.
 * - The legacy `pages` table (pre-v3 full text) is covered too.
 */
import { db, type ConversationMessageRecord } from "../db/schema";

export const HANDLED_TABLES = [
  "pages",
  "visitLog",
  "documents",
  "chunks",
  "conversations",
  "messages",
  "digestCache",
] as const;

export const FORGET_WINDOWS_MS = {
  hour: 3_600_000,
  day: 86_400_000,
} as const;

export interface DeleteCounts {
  documents: number;
  chunks: number;
  visits: number;
  conversations: number;
  messages: number;
  pages: number;
}

function zero(): DeleteCounts {
  return { documents: 0, chunks: 0, visits: 0, conversations: 0, messages: 0, pages: 0 };
}

function anyDeleted(c: DeleteCounts): boolean {
  return Object.values(c).some((n) => n > 0);
}

const ALL_TABLES = () => [
  db.pages,
  db.visitLog,
  db.documents,
  db.chunks,
  db.conversations,
  db.messages,
  db.digestCache,
];

async function deleteDocumentsById(ids: number[], out: DeleteCounts): Promise<void> {
  if (!ids.length) return;
  out.chunks += await db.chunks.where("documentId").anyOf(ids).delete();
  await db.documents.bulkDelete(ids);
  out.documents += ids.length;
}

/** Deletes empty conversations among the given ids. */
async function dropEmptyConversations(ids: Iterable<number>, out: DeleteCounts): Promise<void> {
  for (const id of new Set(ids)) {
    const left = await db.messages.where("conversationId").equals(id).count();
    if (left === 0) {
      await db.conversations.delete(id);
      out.conversations += 1;
    }
  }
}

/** Removes data older than `days` (strictly before now - days). 0 disables. */
export async function applyRetention(days: number, now: number = Date.now()): Promise<DeleteCounts> {
  const out = zero();
  if (!Number.isFinite(days) || days < 1) return out;
  const cutoff = now - Math.floor(days) * FORGET_WINDOWS_MS.day;

  await db.transaction("rw", ALL_TABLES(), async () => {
    const oldDocIds = (await db.documents.where("lastVisitedAt").below(cutoff).primaryKeys()) as number[];
    await deleteDocumentsById(oldDocIds, out);
    out.visits += await db.visitLog.where("visitedAt").below(cutoff).delete();
    out.pages += await db.pages.where("visitedAt").below(cutoff).delete();

    const oldConvs = (await db.conversations.where("updatedAt").below(cutoff).primaryKeys()) as number[];
    if (oldConvs.length) {
      out.messages += await db.messages.where("conversationId").anyOf(oldConvs).delete();
      await db.conversations.bulkDelete(oldConvs);
      out.conversations += oldConvs.length;
    }
    if (anyDeleted(out)) await db.digestCache.clear();
  });
  return out;
}

function hostMatches(host: string, site: string): boolean {
  const h = host.toLowerCase();
  return h === site || h.endsWith(`.${site}`);
}

function citesSite(m: ConversationMessageRecord, site: string): boolean {
  if (!m.citedChunksJson) return false;
  try {
    const cited = JSON.parse(m.citedChunksJson) as { url?: string }[];
    return cited.some((c) => {
      try {
        return typeof c.url === "string" && hostMatches(new URL(c.url).hostname, site);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function normalizeSiteHost(input: string): string {
  let s = String(input ?? "").trim().toLowerCase();
  if (!s) throw new Error("A site hostname is required.");
  if (/^[a-z]+:\/\//.test(s)) {
    s = new URL(s).hostname;
  }
  s = s.replace(/^www\./, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  if (!/^[a-z0-9.-]+$/.test(s) || !s.includes(".") && s !== "localhost") {
    throw new Error(`Not a valid hostname: ${input}`);
  }
  return s;
}

/** Forget one site (and its subdomains) across every store. */
export async function forgetSite(hostname: string): Promise<DeleteCounts> {
  const site = normalizeSiteHost(hostname);
  const out = zero();
  await db.transaction("rw", ALL_TABLES(), async () => {
    const docIds = (await db.documents
      .filter((d) => hostMatches(d.domain || safeHost(d.url), site))
      .primaryKeys()) as number[];
    await deleteDocumentsById(docIds, out);
    out.visits += await db.visitLog.filter((v) => hostMatches(v.hostname || safeHost(v.url), site)).delete();
    out.pages += await db.pages.filter((p) => hostMatches(safeHost(p.url), site)).delete();

    const citing = await db.messages
      .filter((m) => m.role === "assistant" && citesSite(m, site))
      .toArray();
    if (citing.length) {
      await db.messages.bulkDelete(citing.map((m) => m.id as number));
      out.messages += citing.length;
      await dropEmptyConversations(citing.map((m) => m.conversationId), out);
    }
    if (anyDeleted(out)) await db.digestCache.clear();
  });
  return out;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Forget everything captured or written at or after `since` (last hour / day). */
export async function forgetSince(since: number): Promise<DeleteCounts> {
  const out = zero();
  await db.transaction("rw", ALL_TABLES(), async () => {
    const docIds = (await db.documents.where("lastVisitedAt").aboveOrEqual(since).primaryKeys()) as number[];
    await deleteDocumentsById(docIds, out);
    out.visits += await db.visitLog.where("visitedAt").aboveOrEqual(since).delete();
    out.pages += await db.pages.where("visitedAt").aboveOrEqual(since).delete();

    const recentMsgs = await db.messages.where("timestamp").aboveOrEqual(since).toArray();
    if (recentMsgs.length) {
      await db.messages.bulkDelete(recentMsgs.map((m) => m.id as number));
      out.messages += recentMsgs.length;
      await dropEmptyConversations(recentMsgs.map((m) => m.conversationId), out);
    }
    if (anyDeleted(out)) await db.digestCache.clear();
  });
  return out;
}

/** Wipes every store, the legacy pages table included. */
export async function forgetAll(): Promise<void> {
  await db.transaction("rw", ALL_TABLES(), async () => {
    for (const t of ALL_TABLES()) await t.clear();
  });
}
