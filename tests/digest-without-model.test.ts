import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The digest used to show one line, "Cloud chat is turned off.", and nothing
 * else: no model, no digest. Cortex already knows every page of the period
 * without asking a model, so the reading focus is written from those pages.
 */
vi.mock("../src/lib/chat/llm-router", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/chat/llm-router")>(
    "../src/lib/chat/llm-router"
  );
  return {
    ...actual,
    decideRoute: vi.fn(async () => {
      throw new actual.ChatUnavailableError("Cloud chat is turned off.", "Turn it on in settings.");
    }),
    streamAnswer: vi.fn(),
  };
});

const { generateDigest, finishReadingFocus } = await import("../src/lib/chat/digest-engine");
const { db } = await import("../src/db/schema");

const NOW = Date.now();

async function addPage(i: number, domain: string): Promise<void> {
  const documentId = (await db.documents.add({
    url: `https://${domain}/page-${i}`,
    domain,
    title: `Page ${i} on ${domain}`,
    summary: `A page about survey ${i}.`,
    lastVisitedAt: NOW - i * 1000,
    visitCount: 1,
    importanceScore: 0.4,
  })) as number;
  await db.chunks.add({
    documentId,
    ord: 0,
    text: `The survey ${i} team recorded readings near the northern ridge for several nights.`,
    embedState: "embedded",
    chunkVersion: 2,
  } as never);
}

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
});

describe("digest with no model available", () => {
  it("still lists the pages and the sites, and says what is missing", async () => {
    await addPage(1, "www.youtube.com");
    await addPage(2, "www.youtube.com");
    await addPage(3, "github.com");

    const digest = await generateDigest(
      { range: "today" },
      { mode: "on-device-only", cloudEnabled: false, geminiApiKey: "" } as never
    );

    expect(digest.pageCount).toBe(3);
    expect(digest.domainsCount).toBe(2);
    expect(digest.sources.length).toBe(3);
    expect(digest.domainGroups.map((g) => g.domain)).toContain("www.youtube.com");
    expect(digest.narrative).toMatch(/Your recent reading focused on www\.youtube\.com and github\.com/);
    expect(digest.narrative).toMatch(/including Page/);
    expect(digest.narrative).not.toMatch(/Cloud chat is turned off/);
    expect(digest.narrative).not.toMatch(/Gemini API error/);
    expect(digest.narrativeParts.some((p) => p.text.includes("www.youtube.com") && p.sourceIndexes.length > 0)).toBe(true);
    expect(digest.citationsFromModel).toBe(false);
  });
});

describe("finishReadingFocus", () => {
  it("drops a cut-off site sentence and names the sites the model never finished", () => {
    const sources = [
      {
        n: 1,
        url: "https://www.linkedin.com/in/a",
        title: "Jill Stover Heinze",
        domain: "www.linkedin.com",
        visitedAt: 1,
      },
      {
        n: 2,
        url: "https://codepen.io/pen",
        title: "Advanced AI Chatbot Interface",
        domain: "codepen.io",
        visitedAt: 1,
      },
      {
        n: 3,
        url: "https://web.whatsapp.com/",
        title: "WhatsApp Web",
        domain: "web.whatsapp.com",
        visitedAt: 1,
      },
    ];
    const groups = [
      { domain: "www.linkedin.com", count: 6, sourceIndexes: [1] },
      { domain: "codepen.io", count: 1, sourceIndexes: [2] },
      { domain: "web.whatsapp.com", count: 1, sourceIndexes: [3] },
    ];
    const out = finishReadingFocus(
      [
        {
          text: "Your recent reading focused on AI agent integration protocols.",
          sourceIndexes: [],
        },
        {
          text: "On www.linkedin.com you browsed 6 pages to review interview questions.",
          sourceIndexes: [1],
        },
        { text: "On codepen.io", sourceIndexes: [] },
      ],
      groups,
      sources
    );

    expect(out.narrativeParts.some((p) => p.text === "On codepen.io")).toBe(false);
    expect(out.narrative).toMatch(/On codepen\.io you read 1 page, including Advanced AI Chatbot Interface/);
    expect(out.narrative).toMatch(/On web\.whatsapp\.com you read 1 page, including WhatsApp Web/);
    expect(out.narrative).toMatch(/www\.linkedin\.com you browsed 6 pages/);
  });
});
