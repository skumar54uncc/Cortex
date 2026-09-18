import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { db, chunkKind } from "../src/db/schema";
import { saveHighlight, HIGHLIGHT_LIMITS } from "../src/lib/highlights";

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
});

describe("saveHighlight", () => {
  it("creates a document when the page is not indexed yet, plus a highlight row and a highlight chunk", async () => {
    const r = await saveHighlight(
      { url: "https://example.com/a#section", title: "Tidal notes", quote: "  Slack tide is the best time to service turbines.  ", note: "check for Bergen" },
      1_000
    );
    const doc = await db.documents.get(r.documentId);
    expect(doc?.url).toBe("https://example.com/a");
    expect(doc?.title).toBe("Tidal notes");
    const chunk = await db.chunks.get(r.chunkId);
    expect(chunkKind(chunk!)).toBe("highlight");
    expect(chunk!.embedState).toBe("pending");
    expect(chunk!.text).toBe("Slack tide is the best time to service turbines.\n\nNote: check for Bergen");
    expect(chunk!.locator).toEqual({ quote: "Slack tide is the best time to service turbines.", note: "check for Bergen" });
    const h = await db.highlights.get(r.highlightId);
    expect(h).toMatchObject({ documentId: r.documentId, url: "https://example.com/a", chunkId: r.chunkId, createdAt: 1_000 });
  });

  it("reuses the existing document and keeps its text chunks", async () => {
    const docId = (await db.documents.add({ url: "https://example.com/a", domain: "example.com", title: "T", summary: "", lastVisitedAt: 1, visitCount: 1, importanceScore: 0.1 })) as number;
    await db.chunks.add({ documentId: docId, ord: 0, text: "page text" });
    const r = await saveHighlight({ url: "https://example.com/a", title: "T", quote: "page" }, 5);
    expect(r.documentId).toBe(docId);
    expect(await db.documents.count()).toBe(1);
    expect(await db.chunks.where("documentId").equals(docId).count()).toBe(2);
  });

  it("caps quote and note length and rejects empty selections and non-http pages", async () => {
    const r = await saveHighlight({ url: "https://e.test/", title: "T", quote: "x".repeat(5000), note: "n".repeat(5000) }, 1);
    const h = await db.highlights.get(r.highlightId);
    expect(h!.quote.length).toBe(HIGHLIGHT_LIMITS.quote);
    expect(h!.note!.length).toBe(HIGHLIGHT_LIMITS.note);
    await expect(saveHighlight({ url: "https://e.test/", title: "T", quote: "   " }, 1)).rejects.toThrow();
    await expect(saveHighlight({ url: "chrome://settings", title: "T", quote: "x" }, 1)).rejects.toThrow();
  });

  it("redacts PII in the saved quote like page indexing does", async () => {
    // Same patterns as the index path (card numbers, SSNs, tokens, API keys).
    const r = await saveHighlight({ url: "https://e.test/", title: "T", quote: "My SSN is 123-45-6789, keep it safe" }, 1);
    const h = await db.highlights.get(r.highlightId);
    expect(h!.quote).not.toContain("123-45-6789");
    expect(h!.quote).toContain("[REDACTED]");
  });
});
