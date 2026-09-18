/**
 * Markdown vault export (Phase 5.10): one note per page, an index, one file
 * per collection, and a people list, zipped by the caller. Works as an
 * Obsidian vault. Page text is written as text: "<" is escaped so no viewer
 * renders page HTML.
 */
import { chunkKind, type ChunkKind } from "../../db/schema";
import { CHUNK_PROFILES, reconstructTextFromChunks } from "../chunking";
import { youtubeCitationHref } from "../capture/youtube";
import { formatClock } from "../kind-labels";
import type { BackupChunk, CortexBackup } from "./backup";
import { safeZipPath, type ZipEntry } from "./zip";

function md(text: string): string {
  return text.replace(/</g, "&lt;");
}

function day(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function slug(title: string): string {
  const s = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || "page";
}

function section(title: string, body: string[]): string {
  return body.length ? `\n## ${title}\n\n${body.join("\n\n")}\n` : "";
}

function noteFor(doc: CortexBackup["stores"]["documents"][number], chunks: BackupChunk[]): string {
  const byKind = new Map<ChunkKind, BackupChunk[]>();
  for (const c of [...chunks].sort((a, b) => a.ord - b.ord)) {
    const k = chunkKind(c);
    byKind.set(k, [...(byKind.get(k) ?? []), c]);
  }
  const kinds = [...byKind.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, list]) => `${k}: ${list.length}`)
    .join(", ");
  const front = [
    "---",
    `title: ${JSON.stringify(doc.title)}`,
    `url: ${JSON.stringify(doc.url)}`,
    `visited: ${day(doc.lastVisitedAt)}`,
    `visits: ${doc.visitCount}`,
    `kinds: { ${kinds} }`,
    "---",
  ].join("\n");

  const text = byKind.get("text") ?? [];
  const body = [
    `# ${md(doc.title)}`,
    "",
    `Source: <${doc.url}>`,
    doc.summary ? `\n${md(doc.summary)}` : "",
  ].join("\n");

  const highlights = (byKind.get("highlight") ?? []).map((c) => {
    const loc = c.locator as { quote?: string; note?: string } | undefined;
    const quote = md(loc?.quote ?? c.text)
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n");
    return loc?.note ? `${quote}\n\nNote: ${md(loc.note)}` : quote;
  });
  const transcript = (byKind.get("transcript") ?? []).map((c) => {
    const loc = c.locator as { videoId: string; startSec: number } | undefined;
    return loc ? `[${formatClock(loc.startSec)}](${youtubeCitationHref(loc)}) ${md(c.text)}` : md(c.text);
  });
  const pdf = (byKind.get("pdf") ?? []).map((c) => `### Page ${(c.locator as { page?: number })?.page ?? "?"}\n\n${md(c.text)}`);
  const tables = (byKind.get("table") ?? []).map((c) => {
    const l = c.locator as { caption?: string; rowStart?: number; rowEnd?: number } | undefined;
    const head = l ? `### ${md(l.caption || "Table")}, rows ${l.rowStart} to ${l.rowEnd}` : "### Table";
    return `${head}\n\n${md(c.text)}`;
  });
  const images = (byKind.get("image") ?? []).map((c) => md(c.text));

  return [
    front,
    body,
    section("Highlights", highlights),
    section("Text", text.length ? [md(reconstructTextFromChunks(text, doc.chunkingVersion === 1 ? CHUNK_PROFILES.wide : CHUNK_PROFILES.compact))] : []),
    section("Transcript", transcript),
    section("PDF pages", pdf),
    section("Tables", tables),
    section("Images", images),
  ].join("\n");
}

export function buildVault(backup: CortexBackup): ZipEntry[] {
  const s = backup.stores;
  const chunksByDoc = new Map<number, BackupChunk[]>();
  for (const c of s.chunks) chunksByDoc.set(c.documentId, [...(chunksByDoc.get(c.documentId) ?? []), c]);

  const used = new Set<string>();
  const pathOf = new Map<number, string>();
  const docs = [...s.documents].sort((a, b) => a.id - b.id);
  for (const d of docs) {
    const base = slug(d.title);
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
    used.add(name);
    pathOf.set(d.id, `notes/${name}.md`);
  }

  const files: ZipEntry[] = [];
  const index = ["# Cortex library", "", `Exported ${day(backup.exportedAt)}. ${docs.length} pages.`, ""];
  for (const d of [...docs].sort((a, b) => b.lastVisitedAt - a.lastVisitedAt || a.id - b.id)) {
    index.push(`- [${md(d.title)}](${pathOf.get(d.id)}) (${d.domain}, ${day(d.lastVisitedAt)})`);
  }
  files.push({ path: "index.md", data: `${index.join("\n")}\n` });
  for (const d of docs) files.push({ path: pathOf.get(d.id)!, data: noteFor(d, chunksByDoc.get(d.id) ?? []) });

  const titleOf = new Map(docs.map((d) => [d.id, d.title]));
  const colNames = new Set<string>();
  for (const c of s.collections) {
    let name = safeZipPath(c.name);
    for (let n = 2; colNames.has(name); n++) name = `${safeZipPath(c.name)} ${n}`;
    colNames.add(name);
    const links = s.collectionItems
      .filter((i) => i.collectionId === c.id && pathOf.has(i.documentId))
      .map((i) => `- [${md(titleOf.get(i.documentId) ?? "Page")}](../${pathOf.get(i.documentId)})`);
    files.push({ path: `collections/${name}.md`, data: `# ${md(c.name)}\n\n${links.join("\n")}\n` });
  }

  if (s.people.length) {
    const lines = s.people.map((p) => {
      const detail = [p.headline, p.company].filter(Boolean).map(md).join(", ");
      return `- [${md(p.name)}](${p.profileUrl})${detail ? `: ${detail}` : ""}`;
    });
    files.push({ path: "people.md", data: `# People\n\n${lines.join("\n")}\n` });
  }
  return files;
}
