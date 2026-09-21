import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { search } = vi.hoisted(() => ({
  search: vi.fn(async () => ({ hits: [], chunks: [] })),
}));
vi.mock("../src/lib/search-engine", () => ({ runAdvancedSearch: search }));

import { db } from "../src/db/schema";
import { runChat } from "../src/lib/chat/chat-engine";

const settings = { mode: "on-device-only" as const, cloudEnabled: false, geminiApiKey: "" };

async function collect(question: string) {
  const events: { type: string; data: unknown }[] = [];
  for await (const ev of runChat(null, question, settings, async () => null)) events.push(ev);
  return events;
}

async function addDoc(url: string, title: string, when: number, summary = "") {
  await db.documents.add({
    url,
    domain: new URL(url).hostname,
    title,
    summary,
    lastVisitedAt: when,
    visitCount: 1,
    importanceScore: 0.2,
  });
}

describe("Ask answers 'what did I see today' from the visit record", () => {
  beforeEach(async () => {
    for (const t of db.tables) await t.clear();
    search.mockClear();
    const now = Date.now();
    await addDoc("https://www.youtube.com/watch?v=a", "How microchips are made", now - 3_600_000, "Wafer lithography");
    await addDoc("https://www.youtube.com/watch?v=b", "Insect robots from Harvard", now - 7_200_000);
    await addDoc("https://www.amazon.in/dp/x", "Foot massager", now - 1_000);
    await addDoc("https://old.test/page", "Last month", now - 40 * 86_400_000);
  });

  it("names what was watched, site by site, without searching passages", async () => {
    const events = await collect("what did I see on Youtube today? Give me key takeaways");
    const text = events.filter((e) => e.type === "token").map((e) => String(e.data)).join("");

    expect(text).toContain("www.youtube.com");
    expect(text).toContain("How microchips are made");
    expect(text).not.toContain("Foot massager");
    expect(text).not.toContain("Last month");
    expect(search).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toContain("done");
  });

  it("offers the pages as citable sources so the panel can link them", async () => {
    const events = await collect("what did I read today");
    const sources = events.find((e) => e.type === "sources")?.data as { chunks: { document: { url: string } }[] };
    expect(sources.chunks.length).toBeGreaterThan(0);
    expect(sources.chunks.map((c) => c.document.url)).toContain("https://www.amazon.in/dp/x");
  });

  it("says plainly when the period has nothing", async () => {
    for (const t of db.tables) await t.clear();
    const events = await collect("what did I watch on youtube today");
    const text = events.filter((e) => e.type === "token").map((e) => String(e.data)).join("");
    expect(text.toLowerCase()).toContain("nothing");
  });

  it("leaves ordinary questions to search", async () => {
    search.mockResolvedValueOnce({ hits: [], chunks: [] });
    await collect("what is the boiling point of nitrogen");
    expect(search).toHaveBeenCalled();
  });
});
