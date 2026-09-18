import { describe, it, expect } from "vitest";
import { buildVault } from "../src/lib/export/markdown-vault";
import type { CortexBackup } from "../src/lib/export/backup";

const T = Date.parse("2026-09-01T10:00:00Z");

const backup: CortexBackup = {
  format: "cortex-backup",
  version: 1,
  schemaVersion: 6,
  exportedAt: T,
  stores: {
    documents: [
      { id: 1, url: "https://a.test/aurora", domain: "a.test", title: "Aurora: notes", summary: "Drift log", lastVisitedAt: T, visitCount: 3, importanceScore: 0.2 },
      { id: 2, url: "https://www.youtube.com/watch?v=abc123", domain: "www.youtube.com", title: "Aurora: notes", summary: "", lastVisitedAt: T, visitCount: 1, importanceScore: 0 },
    ],
    chunks: [
      { id: 10, documentId: 1, ord: 1, text: "Second part <script>alert(1)</script>" },
      { id: 11, documentId: 1, ord: 0, text: "First part of the notes." },
      { id: 12, documentId: 1, ord: 2000, text: "Fluxgate recalibrated", kind: "pdf", locator: { page: 2 } },
      { id: 13, documentId: 1, ord: 5000, text: "Station: North; Drift: 4", kind: "table", locator: { tableIndex: 0, rowStart: 1, rowEnd: 12, caption: "Drift" } },
      { id: 14, documentId: 1, ord: 9000, text: "4 nT per hour", kind: "highlight", locator: { quote: "4 nT per hour", note: "check" } },
      { id: 15, documentId: 2, ord: 0, text: "welcome to the aurora talk", kind: "transcript", locator: { videoId: "abc123", startSec: 760, endSec: 820 } },
    ],
    visitLog: [],
    conversations: [],
    messages: [],
    people: [
      { kind: "person", name: "Ada Field", headline: "Glaciologist", company: "Polar Lab", profileUrl: "https://www.linkedin.com/in/ada/", firstSeen: T, lastSeen: T, visitCount: 2 },
    ],
    collections: [{ id: 1, name: "Research / 2026", createdAt: T }],
    collectionItems: [{ collectionId: 1, documentId: 1, addedAt: T }],
    highlights: [{ documentId: 1, url: "https://a.test/aurora", quote: "4 nT per hour", note: "check", createdAt: T, chunkId: 14 }],
  },
};

describe("buildVault", () => {
  const files = new Map(buildVault(backup).map((f) => [f.path, f.data as string]));

  it("writes one note per page with unique, portable names, an index, collections and people", () => {
    expect([...files.keys()].sort()).toEqual(
      ["index.md", "notes/aurora-notes.md", "notes/aurora-notes-2.md", "collections/Research 2026.md", "people.md"].sort()
    );
    expect(files.get("index.md")).toContain("- [Aurora: notes](notes/aurora-notes.md) (a.test, 2026-09-01)");
  });

  it("note: front matter, text in order, highlights as quotes, PDF pages, tables; HTML neutralized", () => {
    const note = files.get("notes/aurora-notes.md")!;
    expect(note.startsWith('---\ntitle: "Aurora: notes"\nurl: "https://a.test/aurora"\nvisited: 2026-09-01\nvisits: 3\n')).toBe(true);
    expect(note).toContain("kinds: { highlight: 1, pdf: 1, table: 1, text: 2 }");
    expect(note.indexOf("First part")).toBeLessThan(note.indexOf("Second part"));
    expect(note).toContain("> 4 nT per hour\n\nNote: check");
    expect(note).toContain("### Page 2\n\nFluxgate recalibrated");
    expect(note).toContain("### Drift, rows 1 to 12");
    expect(note).not.toContain("<script>");
    expect(note).toContain("&lt;script>");
  });

  it("transcript windows link to their moment in the video", () => {
    expect(files.get("notes/aurora-notes-2.md")).toContain(
      "[12:40](https://www.youtube.com/watch?v=abc123&t=760s) welcome to the aurora talk"
    );
  });

  it("collections link to their notes; people are listed", () => {
    expect(files.get("collections/Research 2026.md")).toBe("# Research / 2026\n\n- [Aurora: notes](../notes/aurora-notes.md)\n");
    expect(files.get("people.md")).toContain("- [Ada Field](https://www.linkedin.com/in/ada/): Glaciologist, Polar Lab");
  });
});
