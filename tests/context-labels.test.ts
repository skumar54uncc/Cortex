import { describe, it, expect } from "vitest";
import { buildChatPrompt } from "../src/lib/chat/context-builder";
import type { ChunkWithDoc } from "../src/lib/search-engine";

const doc = (url: string, title: string) => ({
  id: 1,
  url,
  domain: new URL(url).hostname,
  title,
  summary: "",
  lastVisitedAt: Date.parse("2026-09-01T10:00:00Z"),
  visitCount: 1,
  importanceScore: 0,
});

const chunks = [
  { id: 1, documentId: 1, ord: 0, text: "Plain article text.", document: doc("https://a.test/a", "Article") },
  {
    id: 2,
    documentId: 2,
    ord: 0,
    text: "welcome to the aurora talk",
    kind: "transcript",
    locator: { videoId: "abc", startSec: 760, endSec: 820 },
    document: doc("https://www.youtube.com/watch?v=abc", "Aurora talk"),
  },
  {
    id: 3,
    documentId: 3,
    ord: 0,
    text: "Model: Synth 13; Price: 113",
    kind: "table",
    locator: { tableIndex: 0, rowStart: 13, rowEnd: 24, caption: "Prices" },
    document: doc("https://shop.test/synths", "Synths"),
  },
  { id: 4, documentId: 4, ord: 0, text: "Fluxgate", kind: "pdf", locator: { page: 4 }, document: doc("https://p.test/notes.pdf", "Notes") },
  { id: 5, documentId: 5, ord: 0, text: "Drone photo", kind: "image", document: doc("https://i.test/", "Photos") },
  { id: 6, documentId: 1, ord: 0, text: "4 nT", kind: "highlight", locator: { quote: "4 nT" }, document: doc("https://a.test/a", "Article") },
] as unknown as ChunkWithDoc[];

describe("buildChatPrompt snippet labels", () => {
  const prompt = buildChatPrompt({ question: "q", chunks });

  it("labels each snippet by kind and locator; plain text stays unlabeled", () => {
    expect(prompt).toContain('[1] "Article" (a.test, visited 2026-09-01)');
    expect(prompt).toContain('[2] (video 12:40 to 13:40) "Aurora talk"');
    expect(prompt).toContain('[3] (table: Prices, rows 13 to 24) "Synths"');
    expect(prompt).toContain('[4] (PDF page 4) "Notes"');
    expect(prompt).toContain('[5] (image) "Photos"');
    expect(prompt).toContain('[6] (highlight) "Article"');
  });

  it("gives the moment or page link as the source URL", () => {
    expect(prompt).toContain("URL: https://www.youtube.com/watch?v=abc&t=760s");
    expect(prompt).toContain("URL: https://p.test/notes.pdf#page=4");
    expect(prompt).toContain("URL: https://a.test/a\n");
  });
});
