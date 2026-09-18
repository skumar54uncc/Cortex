/**
 * Collections (Phase 5.4): named sets of pages such as "Job search". Search
 * and Ask can be scoped to one collection. Deleting a collection never deletes
 * the pages.
 */
import { db } from "../db/schema";
import { safeHttpHttpsHref } from "./url-security";

export const COLLECTION_NAME_MAX = 60;

export interface CollectionSummary {
  id: number;
  name: string;
  createdAt: number;
  count: number;
}

function cleanName(name: string): string {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, COLLECTION_NAME_MAX);
}

export async function createCollection(name: string, now: number = Date.now()): Promise<number> {
  const n = cleanName(name);
  if (!n) throw new Error("Give the collection a name.");
  const clash = await db.collections.filter((c) => c.name.toLowerCase() === n.toLowerCase()).first();
  if (clash) throw new Error(`A collection named "${clash.name}" already exists.`);
  return (await db.collections.add({ name: n, createdAt: now })) as number;
}

export async function listCollections(): Promise<CollectionSummary[]> {
  const cols = await db.collections.orderBy("createdAt").toArray();
  const out: CollectionSummary[] = [];
  for (const c of cols) {
    const count = await db.collectionItems.where("collectionId").equals(c.id as number).count();
    out.push({ id: c.id as number, name: c.name, createdAt: c.createdAt, count });
  }
  return out;
}

export async function deleteCollection(id: number): Promise<void> {
  await db.transaction("rw", [db.collections, db.collectionItems], async () => {
    await db.collectionItems.where("collectionId").equals(id).delete();
    await db.collections.delete(id);
  });
}

export async function addDocumentToCollection(
  collectionId: number,
  documentId: number,
  now: number = Date.now()
): Promise<void> {
  if (!(await db.collections.get(collectionId))) throw new Error("Unknown collection.");
  if (!(await db.documents.get(documentId))) throw new Error("Unknown page.");
  const exists = await db.collectionItems
    .where("[collectionId+documentId]")
    .equals([collectionId, documentId])
    .first();
  if (exists) return;
  await db.collectionItems.add({ collectionId, documentId, addedAt: now });
}

export async function removeDocumentFromCollection(collectionId: number, documentId: number): Promise<void> {
  await db.collectionItems.where("[collectionId+documentId]").equals([collectionId, documentId]).delete();
}

export async function documentIdsInCollection(collectionId: number): Promise<Set<number>> {
  const rows = await db.collectionItems.where("collectionId").equals(collectionId).toArray();
  return new Set(rows.map((r) => r.documentId));
}

/**
 * Adds a web page to a collection. Uses the indexed document for the URL
 * (fragment ignored) or creates a minimal one; normal indexing fills it in
 * later under the same URL. The caller runs the privacy gate first.
 */
export async function addPageToCollection(
  collectionId: number,
  url: string,
  title: string,
  now: number = Date.now()
): Promise<{ documentId: number; created: boolean }> {
  const safe = safeHttpHttpsHref(url);
  if (!safe) throw new Error("Only web pages can be added to a collection.");
  const u = new URL(safe);
  u.hash = "";
  const pageUrl = u.href;
  let created = false;
  let doc = await db.documents.where("url").equals(pageUrl).first();
  if (!doc) {
    const id = (await db.documents.add({
      url: pageUrl,
      domain: u.hostname,
      title: String(title ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || u.hostname,
      summary: "",
      lastVisitedAt: now,
      visitCount: 1,
      importanceScore: 0.15,
    })) as number;
    doc = await db.documents.get(id);
    created = true;
  }
  await addDocumentToCollection(collectionId, doc!.id as number, now);
  return { documentId: doc!.id as number, created };
}
