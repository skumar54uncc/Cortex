import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { search } = vi.hoisted(() => ({
  search: vi.fn(async () => ({ hits: [], chunks: [] })),
}));
vi.mock("../src/lib/search-engine", () => ({ runAdvancedSearch: search }));

import { db } from "../src/db/schema";
import { runChat } from "../src/lib/chat/chat-engine";
import { upsertPerson } from "../src/lib/people";

const settings = { mode: "on-device-only" as const, cloudEnabled: false, geminiApiKey: "" };

async function collect(question: string, s: typeof settings & { peopleEnabled?: boolean }) {
  const events: { type: string; data: unknown }[] = [];
  for await (const ev of runChat(null, question, s, async () => null)) events.push(ev);
  return events;
}

describe("Ask answers people questions from the people store", () => {
  beforeEach(async () => {
    for (const t of db.tables) await t.clear();
    search.mockClear();
    await upsertPerson({
      kind: "person",
      name: "Mira Okafor-Lind",
      headline: "Head of Field Programs at Tidora",
      company: "Tidora",
      profileUrl: "https://www.linkedin.com/in/mira/",
    });
  });

  it("answers without searching pages or calling a model, and stores the exchange", async () => {
    const events = await collect("who did I view from Tidora", settings);
    const text = events.filter((e) => e.type === "token").map((e) => String(e.data)).join("");
    expect(text).toContain("Mira Okafor-Lind");
    expect(text).toContain("https://www.linkedin.com/in/mira/");
    expect(events.map((e) => e.type)).toContain("done");
    expect(search).not.toHaveBeenCalled();
    const msgs = await db.messages.toArray();
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].content).toContain("Mira Okafor-Lind");
  });

  it("falls back to RAG when nobody matches", async () => {
    const events = await collect("who did I view from Brewlog", settings);
    expect(search).toHaveBeenCalled();
    expect(events.map((e) => e.type)).toContain("error"); // empty library in this test
  });

  it("does not use the people store when people memory is turned off", async () => {
    await collect("who did I view from Tidora", { ...settings, peopleEnabled: false });
    expect(search).toHaveBeenCalled();
  });
});
