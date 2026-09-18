// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildSourceItem, citationLink, citedFromChunk } from "../src/content/citation-cards";
import type { ChunkWithDoc } from "../src/lib/search-engine";

const doc = (url: string, title: string) => ({
  id: 1,
  url,
  domain: new URL(url).hostname,
  title,
  summary: "",
  lastVisitedAt: 0,
  visitCount: 1,
  importanceScore: 0,
});

const video = {
  id: 2,
  documentId: 2,
  ord: 0,
  text: "",
  kind: "transcript",
  locator: { videoId: "abc", startSec: 760, endSec: 820 },
  document: doc("https://www.youtube.com/watch?v=abc", 'Aurora <img src=x onerror="alert(1)">'),
} as unknown as ChunkWithDoc;
const pdf = { id: 3, documentId: 3, ord: 0, text: "", kind: "pdf", locator: { page: 4 }, document: doc("https://p.test/n.pdf", "Notes") } as unknown as ChunkWithDoc;
const table = {
  id: 4,
  documentId: 4,
  ord: 0,
  text: "",
  kind: "table",
  locator: { tableIndex: 0, rowStart: 13, rowEnd: 24, caption: "Prices" },
  document: doc("https://shop.test/s", "Synths"),
} as unknown as ChunkWithDoc;
const plain = { id: 5, documentId: 5, ord: 0, text: "", document: doc("https://a.test/a", "Article") } as unknown as ChunkWithDoc;

describe("citation cards", () => {
  it("video source links to the moment, shows the time, and keeps page text as text", () => {
    const item = buildSourceItem(video, 1);
    expect(item.href).toBe("https://www.youtube.com/watch?v=abc&t=760s");
    expect(item.rel).toBe("noopener noreferrer");
    expect(item.querySelector(".cortex-source-num")!.textContent).toBe("[2]");
    expect(item.querySelector(".cortex-source-detail")!.textContent).toBe("Video at 12:40");
    expect(item.querySelector("img")).toBeNull();
    expect(item.querySelector(".cortex-source-title")!.textContent).toContain("<img");
  });

  it("PDF and table sources show page and rows", () => {
    expect(buildSourceItem(pdf, 0).href).toBe("https://p.test/n.pdf#page=4");
    expect(buildSourceItem(pdf, 0).querySelector(".cortex-source-detail")!.textContent).toBe("PDF page 4");
    expect(buildSourceItem(table, 0).querySelector(".cortex-source-detail")!.textContent).toBe("Table rows 13 to 24");
  });

  it("plain pages have no detail line; unsafe URLs never become links", () => {
    expect(buildSourceItem(plain, 0).querySelector(".cortex-source-detail")).toBeNull();
    const bad = { ...plain, document: { ...plain.document, url: "javascript:alert(1)" } } as ChunkWithDoc;
    expect(buildSourceItem(bad, 0).getAttribute("href")).toBe("#");
  });

  it("inline [N] links use the same per-kind target and describe it", () => {
    const a = citationLink(video, 1);
    expect(a.textContent).toBe("1");
    expect(a.href).toBe("https://www.youtube.com/watch?v=abc&t=760s");
    expect(a.title).toBe('Aurora <img src=x onerror="alert(1)">, Video at 12:40');
  });

  it("stored citations keep kind and locator so reopened chats link the same way", () => {
    expect(citedFromChunk(video)).toEqual({
      chunkId: 2,
      documentId: 2,
      url: "https://www.youtube.com/watch?v=abc",
      title: 'Aurora <img src=x onerror="alert(1)">',
      kind: "transcript",
      locator: { videoId: "abc", startSec: 760, endSec: 820 },
    });
    expect(citedFromChunk(plain)).toEqual({ chunkId: 5, documentId: 5, url: "https://a.test/a", title: "Article" });
  });
});
