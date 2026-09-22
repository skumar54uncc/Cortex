import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The digest used to show one line, "Cloud chat is turned off.", and nothing
 * else: no model, no digest. Cortex already knows every page of the period
 * without asking a model, so it lists them and says the narrative is what is
 * missing.
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

const { generateDigest } = await import("../src/lib/chat/digest-engine");
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
    expect(digest.narrative).toMatch(/Cloud chat is turned off/);
    expect(digest.citationsFromModel).toBe(false);
  });
});
