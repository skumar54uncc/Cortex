/**
 * JSON backup and restore (Phase 5.10).
 *
 * Backup: every library store, without embeddings (they are recomputed on
 * device after a restore) and without settings, so the Gemini key never
 * leaves chrome.storage.
 *
 * Restore: the file is untrusted input. Every row is type-checked and
 * rebuilt field by field, references must resolve inside the file, and each
 * page URL goes through the same privacy gate as a live visit (blocklist,
 * sensitive hosts, always-skip, allowlist). Merge keeps what is already in the
 * library (pages by URL, collections by name, people by profile URL); replace
 * wipes first and is only offered behind an explicit confirmation.
 */
import {
  db,
  clearAllIndexedData,
  CHUNK_KINDS,
  CORTEX_DB_SCHEMA_VERSION,
  chunkKind,
  type ChunkKind,
  type ChunkLocator,
  type CollectionItemRecord,
  type CollectionRecord,
  type ConversationMessageRecord,
  type ConversationRecord,
  type DocumentRecord,
  type HighlightRecord,
  type PersonRecord,
  type VisitLogEntry,
} from "../../db/schema";
import { safeHttpHttpsHref } from "../url-security";

export const BACKUP_FORMAT = "cortex-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_STORES = [
  "documents",
  "chunks",
  "visitLog",
  "conversations",
  "messages",
  "people",
  "collections",
  "collectionItems",
  "highlights",
] as const;
export type BackupStore = (typeof BACKUP_STORES)[number];

export const BACKUP_LIMITS = {
  rowsPerStore: 1_000_000,
  text: 200_000,
  short: 2_000,
} as const;

type WithId<T> = T & { id: number };

export interface BackupChunk {
  id: number;
  documentId: number;
  ord: number;
  text: string;
  kind?: ChunkKind;
  locator?: ChunkLocator;
}

export interface CortexBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  schemaVersion: number;
  exportedAt: number;
  stores: {
    documents: WithId<DocumentRecord>[];
    chunks: BackupChunk[];
    visitLog: VisitLogEntry[];
    conversations: WithId<ConversationRecord>[];
    messages: ConversationMessageRecord[];
    people: PersonRecord[];
    collections: WithId<CollectionRecord>[];
    collectionItems: CollectionItemRecord[];
    highlights: HighlightRecord[];
  };
}

export type BackupCounts = Record<BackupStore, number>;

function emptyCounts(): BackupCounts {
  return Object.fromEntries(BACKUP_STORES.map((s) => [s, 0])) as BackupCounts;
}

export async function collectBackup(now: number = Date.now()): Promise<CortexBackup> {
  const chunks = await db.chunks.toArray();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schemaVersion: CORTEX_DB_SCHEMA_VERSION,
    exportedAt: now,
    stores: {
      documents: (await db.documents.toArray()) as WithId<DocumentRecord>[],
      chunks: chunks.map((c) => ({
        id: c.id!,
        documentId: c.documentId,
        ord: c.ord,
        text: c.text,
        ...(c.kind ? { kind: c.kind } : {}),
        ...(c.locator ? { locator: c.locator } : {}),
      })),
      visitLog: (await db.visitLog.toArray()).map(({ id: _id, ...v }) => v),
      conversations: (await db.conversations.toArray()) as WithId<ConversationRecord>[],
      messages: (await db.messages.toArray()).map(({ id: _id, ...m }) => m),
      people: (await db.people.toArray()).map(({ id: _id, ...p }) => p),
      collections: (await db.collections.toArray()) as WithId<CollectionRecord>[],
      collectionItems: (await db.collectionItems.toArray()).map(({ id: _id, ...i }) => i),
      highlights: (await db.highlights.toArray()).map(({ id: _id, ...h }) => h),
    },
  };
}

// ---------------------------------------------------------------- validation

class Invalid extends Error {}

type Obj = Record<string, unknown>;

function obj(v: unknown, where: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Invalid(`${where}: not an object`);
  return v as Obj;
}
function str(o: Obj, k: string, where: string, max: number = BACKUP_LIMITS.short): string {
  const v = o[k];
  if (typeof v !== "string" || v.length > max) throw new Invalid(`${where}.${k}: bad text`);
  return v;
}
function optStr(o: Obj, k: string, where: string, max: number = BACKUP_LIMITS.short): string | undefined {
  return o[k] === undefined || o[k] === null ? undefined : str(o, k, where, max);
}
function num(o: Obj, k: string, where: string): number {
  const v = o[k];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Invalid(`${where}.${k}: bad number`);
  return v;
}
function optNum(o: Obj, k: string, where: string): number | undefined {
  return o[k] === undefined || o[k] === null ? undefined : num(o, k, where);
}
function id(o: Obj, k: string, where: string): number {
  const v = num(o, k, where);
  if (!Number.isInteger(v) || v < 1) throw new Invalid(`${where}.${k}: bad id`);
  return v;
}
function url(o: Obj, k: string, where: string): string {
  const v = safeHttpHttpsHref(str(o, k, where, 8_000));
  if (!v) throw new Invalid(`${where}.${k}: not an http(s) URL`);
  return v;
}
function ref(set: Set<number>, v: number, where: string): number {
  if (!set.has(v)) throw new Invalid(`${where}: points to a missing row`);
  return v;
}
function rows(stores: Obj, name: BackupStore): unknown[] {
  const v = stores[name];
  if (!Array.isArray(v) || v.length > BACKUP_LIMITS.rowsPerStore) throw new Invalid(`${name}: not a list`);
  return v;
}

function locatorFor(kind: ChunkKind, raw: unknown, where: string): ChunkLocator | undefined {
  if (raw === undefined || raw === null) return undefined;
  const l = obj(raw, where);
  switch (kind) {
    case "pdf": {
      const page = id(l, "page", where);
      return { page };
    }
    case "transcript":
      return { videoId: str(l, "videoId", where, 64), startSec: num(l, "startSec", where), endSec: num(l, "endSec", where) };
    case "table":
      return {
        tableIndex: num(l, "tableIndex", where),
        rowStart: num(l, "rowStart", where),
        rowEnd: num(l, "rowEnd", where),
        caption: str(l, "caption", where),
      };
    case "image": {
      if (!Array.isArray(l.images) || l.images.length > 50) throw new Invalid(`${where}.images: bad list`);
      return { images: l.images.map((i, n) => { const o = obj(i, `${where}.images[${n}]`); return { src: url(o, "src", where), alt: str(o, "alt", where) }; }) };
    }
    case "highlight": {
      const note = optStr(l, "note", where, BACKUP_LIMITS.text);
      return { quote: str(l, "quote", where, BACKUP_LIMITS.text), ...(note !== undefined ? { note } : {}) };
    }
    default:
      throw new Invalid(`${where}: text chunks have no locator`);
  }
}

export type ValidateResult =
  | { ok: true; backup: CortexBackup; counts: BackupCounts }
  | { ok: false; error: string };

export function validateBackup(raw: unknown): ValidateResult {
  try {
    const top = obj(raw, "backup");
    if (top.format !== BACKUP_FORMAT) throw new Invalid("This file is not a Cortex backup.");
    if (top.version !== BACKUP_VERSION) throw new Invalid("This backup was made by a different Cortex version.");
    const schemaVersion = id(top, "schemaVersion", "backup");
    if (schemaVersion > CORTEX_DB_SCHEMA_VERSION) throw new Invalid("This backup is newer than this Cortex. Update Cortex first.");
    const exportedAt = num(top, "exportedAt", "backup");
    const s = obj(top.stores, "stores");

    const docIds = new Set<number>();
    const documents = rows(s, "documents").map((r, n) => {
      const w = `documents[${n}]`;
      const o = obj(r, w);
      const docId = id(o, "id", w);
      if (docIds.has(docId)) throw new Invalid(`${w}: duplicate id`);
      docIds.add(docId);
      const chunkingVersion = optNum(o, "chunkingVersion", w);
      return {
        id: docId,
        url: url(o, "url", w),
        domain: str(o, "domain", w),
        title: str(o, "title", w),
        summary: str(o, "summary", w, BACKUP_LIMITS.text),
        lastVisitedAt: num(o, "lastVisitedAt", w),
        visitCount: optNum(o, "visitCount", w) ?? 1,
        importanceScore: optNum(o, "importanceScore", w) ?? 0,
        ...(chunkingVersion !== undefined ? { chunkingVersion } : {}),
      };
    });

    const chunkIds = new Set<number>();
    const chunks = rows(s, "chunks").map((r, n) => {
      const w = `chunks[${n}]`;
      const o = obj(r, w);
      const chunkId = id(o, "id", w);
      if (chunkIds.has(chunkId)) throw new Invalid(`${w}: duplicate id`);
      chunkIds.add(chunkId);
      const rawKind = o.kind;
      if (rawKind !== undefined && !CHUNK_KINDS.includes(rawKind as ChunkKind)) throw new Invalid(`${w}.kind: unknown`);
      const kind = rawKind as ChunkKind | undefined;
      const locator = locatorFor(kind ?? "text", o.locator, `${w}.locator`);
      return {
        id: chunkId,
        documentId: ref(docIds, id(o, "documentId", w), w),
        ord: num(o, "ord", w),
        text: str(o, "text", w, BACKUP_LIMITS.text),
        ...(kind ? { kind } : {}),
        ...(locator ? { locator } : {}),
      };
    });

    const visitLog = rows(s, "visitLog").map((r, n) => {
      const w = `visitLog[${n}]`;
      const o = obj(r, w);
      return {
        url: url(o, "url", w),
        title: str(o, "title", w),
        hostname: str(o, "hostname", w),
        visitedAt: num(o, "visitedAt", w),
        textLength: optNum(o, "textLength", w) ?? 0,
      };
    });

    const convIds = new Set<number>();
    const conversations = rows(s, "conversations").map((r, n) => {
      const w = `conversations[${n}]`;
      const o = obj(r, w);
      const convId = id(o, "id", w);
      if (convIds.has(convId)) throw new Invalid(`${w}: duplicate id`);
      convIds.add(convId);
      return { id: convId, createdAt: num(o, "createdAt", w), updatedAt: num(o, "updatedAt", w), title: str(o, "title", w) };
    });

    const messages = rows(s, "messages").map((r, n) => {
      const w = `messages[${n}]`;
      const o = obj(r, w);
      if (o.role !== "user" && o.role !== "assistant") throw new Invalid(`${w}.role: unknown`);
      if (o.provider !== undefined && o.provider !== "nano" && o.provider !== "cloud") throw new Invalid(`${w}.provider: unknown`);
      const cited = optStr(o, "citedChunksJson", w, BACKUP_LIMITS.text);
      if (cited !== undefined) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(cited);
        } catch {
          throw new Invalid(`${w}.citedChunksJson: not JSON`);
        }
        if (!Array.isArray(parsed)) throw new Invalid(`${w}.citedChunksJson: not a list`);
      }
      return {
        conversationId: ref(convIds, id(o, "conversationId", w), w),
        role: o.role,
        content: str(o, "content", w, BACKUP_LIMITS.text),
        timestamp: num(o, "timestamp", w),
        ...(cited !== undefined ? { citedChunksJson: cited } : {}),
        ...(o.provider ? { provider: o.provider as "nano" | "cloud" } : {}),
      } as ConversationMessageRecord;
    });

    const people = rows(s, "people").map((r, n) => {
      const w = `people[${n}]`;
      const o = obj(r, w);
      if (o.kind !== "person" && o.kind !== "company") throw new Invalid(`${w}.kind: unknown`);
      return {
        kind: o.kind,
        name: str(o, "name", w),
        headline: str(o, "headline", w),
        company: str(o, "company", w),
        profileUrl: url(o, "profileUrl", w),
        firstSeen: num(o, "firstSeen", w),
        lastSeen: num(o, "lastSeen", w),
        visitCount: optNum(o, "visitCount", w) ?? 1,
      } as PersonRecord;
    });

    const colIds = new Set<number>();
    const colNames = new Set<string>();
    const collections = rows(s, "collections").map((r, n) => {
      const w = `collections[${n}]`;
      const o = obj(r, w);
      const colId = id(o, "id", w);
      const name = str(o, "name", w, 200).trim();
      if (!name || colIds.has(colId) || colNames.has(name)) throw new Invalid(`${w}: duplicate or empty`);
      colIds.add(colId);
      colNames.add(name);
      return { id: colId, name, createdAt: num(o, "createdAt", w) };
    });

    const collectionItems = rows(s, "collectionItems").map((r, n) => {
      const w = `collectionItems[${n}]`;
      const o = obj(r, w);
      return {
        collectionId: ref(colIds, id(o, "collectionId", w), w),
        documentId: ref(docIds, id(o, "documentId", w), w),
        addedAt: num(o, "addedAt", w),
      };
    });

    const highlights = rows(s, "highlights").map((r, n) => {
      const w = `highlights[${n}]`;
      const o = obj(r, w);
      const note = optStr(o, "note", w, BACKUP_LIMITS.text);
      const chunkId = optNum(o, "chunkId", w);
      return {
        documentId: ref(docIds, id(o, "documentId", w), w),
        url: url(o, "url", w),
        quote: str(o, "quote", w, BACKUP_LIMITS.text),
        ...(note !== undefined ? { note } : {}),
        createdAt: num(o, "createdAt", w),
        ...(chunkId !== undefined ? { chunkId: ref(chunkIds, chunkId, `${w}.chunkId`) } : {}),
      };
    });

    const backup: CortexBackup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      schemaVersion,
      exportedAt,
      stores: { documents, chunks, visitLog, conversations, messages, people, collections, collectionItems, highlights },
    };
    const counts = emptyCounts();
    for (const k of BACKUP_STORES) counts[k] = backup.stores[k].length;
    return { ok: true, backup, counts };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    return { ok: false, error: "This file could not be read as a Cortex backup." };
  }
}

// ------------------------------------------------------------------- restore

export interface RestoreOptions {
  mode: "merge" | "replace";
  /** The live privacy gate for a page URL (blocklist, sensitive, allowlist). */
  allowUrl: (url: string) => Promise<boolean>;
}

export interface RestoreResult {
  added: BackupCounts;
  /** Pages left out by the privacy gate. */
  blocked: number;
  /** New chunks, all `pending`: the service worker embeds them on device. */
  chunkIdsToEmbed: number[];
}

export async function restoreBackup(backup: CortexBackup, opts: RestoreOptions): Promise<RestoreResult> {
  const s = backup.stores;
  // The gate is async and outside Dexie: decide every URL before the transaction.
  const allowed = new Map<string, boolean>();
  const urls = new Set([...s.documents.map((d) => d.url), ...s.visitLog.map((v) => v.url), ...s.people.map((p) => p.profileUrl)]);
  for (const u of urls) allowed.set(u, await opts.allowUrl(u));
  const blocked = s.documents.filter((d) => !allowed.get(d.url)).length;

  if (opts.mode === "replace") await clearAllIndexedData();

  const added = emptyCounts();
  const chunkIdsToEmbed: number[] = [];
  await db.transaction(
    "rw",
    [db.documents, db.chunks, db.visitLog, db.conversations, db.messages, db.people, db.collections, db.collectionItems, db.highlights],
    async () => {
      const docMap = new Map<number, number>();
      const existingDocs = new Set<number>();
      for (const d of s.documents) {
        if (!allowed.get(d.url)) continue;
        const existing = await db.documents.where("url").equals(d.url).first();
        if (existing?.id != null) {
          docMap.set(d.id, existing.id);
          existingDocs.add(existing.id);
          continue;
        }
        const { id: _old, ...rec } = d;
        docMap.set(d.id, (await db.documents.add(rec)) as number);
        added.documents += 1;
      }

      const chunkMap = new Map<number, number>();
      const kindsCache = new Map<number, { kinds: Set<ChunkKind>; byText: Map<string, number> }>();
      const existingOf = async (docId: number) => {
        let v = kindsCache.get(docId);
        if (!v) {
          const rows = await db.chunks.where("documentId").equals(docId).toArray();
          v = { kinds: new Set(rows.map(chunkKind)), byText: new Map(rows.map((r) => [r.text, r.id!])) };
          kindsCache.set(docId, v);
        }
        return v;
      };
      for (const c of s.chunks) {
        const docId = docMap.get(c.documentId);
        if (docId == null) continue;
        if (existingDocs.has(docId)) {
          const ex = await existingOf(docId);
          const same = ex.byText.get(c.text);
          if (same != null) {
            chunkMap.set(c.id, same);
            continue;
          }
          if (ex.kinds.has(c.kind ?? "text")) continue;
        }
        const newId = (await db.chunks.add({
          documentId: docId,
          ord: c.ord,
          text: c.text,
          ...(c.kind ? { kind: c.kind } : {}),
          ...(c.locator ? { locator: c.locator } : {}),
          embedState: "pending",
        })) as number;
        chunkMap.set(c.id, newId);
        chunkIdsToEmbed.push(newId);
        added.chunks += 1;
      }

      const colMap = new Map<number, number>();
      for (const c of s.collections) {
        const existing = await db.collections.where("name").equals(c.name).first();
        if (existing?.id != null) {
          colMap.set(c.id, existing.id);
          continue;
        }
        colMap.set(c.id, (await db.collections.add({ name: c.name, createdAt: c.createdAt })) as number);
        added.collections += 1;
      }
      for (const i of s.collectionItems) {
        const collectionId = colMap.get(i.collectionId);
        const documentId = docMap.get(i.documentId);
        if (collectionId == null || documentId == null) continue;
        const dup = await db.collectionItems.where("[collectionId+documentId]").equals([collectionId, documentId]).first();
        if (dup) continue;
        await db.collectionItems.add({ collectionId, documentId, addedAt: i.addedAt });
        added.collectionItems += 1;
      }

      for (const h of s.highlights) {
        const documentId = docMap.get(h.documentId);
        if (documentId == null) continue;
        const dup = await db.highlights
          .where("documentId")
          .equals(documentId)
          .filter((x) => x.quote === h.quote && x.createdAt === h.createdAt)
          .first();
        if (dup) continue;
        const chunkId = h.chunkId != null ? chunkMap.get(h.chunkId) : undefined;
        await db.highlights.add({
          documentId,
          url: h.url,
          quote: h.quote,
          ...(h.note !== undefined ? { note: h.note } : {}),
          createdAt: h.createdAt,
          ...(chunkId != null ? { chunkId } : {}),
        });
        added.highlights += 1;
      }

      const convMap = new Map<number, number>();
      for (const c of s.conversations) {
        const dup = await db.conversations.where("createdAt").equals(c.createdAt).filter((x) => x.title === c.title).first();
        if (dup) continue;
        const { id: _old, ...rec } = c;
        convMap.set(c.id, (await db.conversations.add(rec)) as number);
        added.conversations += 1;
      }
      for (const m of s.messages) {
        const conversationId = convMap.get(m.conversationId);
        if (conversationId == null) continue;
        let citedChunksJson = m.citedChunksJson;
        if (citedChunksJson) {
          const cited = (JSON.parse(citedChunksJson) as { chunkId?: unknown; documentId?: unknown }[])
            .map((c) => ({
              ...c,
              chunkId: chunkMap.get(Number(c.chunkId)),
              documentId: docMap.get(Number(c.documentId)),
            }))
            .filter((c) => c.chunkId != null && c.documentId != null);
          citedChunksJson = JSON.stringify(cited);
        }
        await db.messages.add({ ...m, conversationId, ...(citedChunksJson !== undefined ? { citedChunksJson } : {}) });
        added.messages += 1;
      }

      for (const p of s.people) {
        if (!allowed.get(p.profileUrl)) continue;
        if (await db.people.where("profileUrl").equals(p.profileUrl).first()) continue;
        await db.people.add(p);
        added.people += 1;
      }

      for (const v of s.visitLog) {
        if (!allowed.get(v.url)) continue;
        const dup = await db.visitLog.where("visitedAt").equals(v.visitedAt).filter((x) => x.url === v.url).first();
        if (dup) continue;
        await db.visitLog.add(v);
        added.visitLog += 1;
      }
    }
  );
  return { added, blocked, chunkIdsToEmbed };
}
