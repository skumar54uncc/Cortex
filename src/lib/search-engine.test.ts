import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DocumentRecord, ChunkRecord } from "../db/schema";
import { runAdvancedSearch } from "./search-engine";

const mocks = vi.hoisted(() => ({
  docs: [] as DocumentRecord[],
  chunks: [] as ChunkRecord[],
  urlsInRange: new Set<string>(),
  collectionItems: [] as { collectionId: number; documentId: number }[],
}));

vi.mock("../db/schema", () => ({
  db: {
    documents: {
      toArray: vi.fn(async () => mocks.docs),
    },
    chunks: {
      toArray: vi.fn(async () => mocks.chunks),
    },
    collectionItems: {
      where: vi.fn(() => ({
        equals: (id: number) => ({
          toArray: async () => mocks.collectionItems.filter((x) => x.collectionId === id),
        }),
      })),
    },
  },
  getUrlsVisitedBetween: vi.fn(
    async (_start: number, _end: number) => mocks.urlsInRange
  ),
}));

function doc(
  id: number,
  url: string,
  title: string,
  visitedAt: number
): DocumentRecord {
  return {
    id,
    url,
    domain: new URL(url).hostname,
    title,
    summary: "",
    lastVisitedAt: visitedAt,
    visitCount: 1,
    importanceScore: 0.5,
  };
}

function ch(id: number, documentId: number, text: string, emb?: number[]): ChunkRecord {
  return {
    id,
    documentId,
    ord: 0,
    text,
    embedding: emb,
    embedState: emb?.length ? "embedded" : undefined,
  };
}

describe("runAdvancedSearch", () => {
  const now = 1_700_000_000_000;

  beforeEach(() => {
    mocks.docs = [];
    mocks.chunks = [];
    mocks.urlsInRange = new Set();
  });

  it("empty semantic query returns no hits without crashing", async () => {
    mocks.docs = [doc(1, "https://a.test/x", "A", now)];
    mocks.chunks = [ch(1, 1, "hello world")];
    const res = await runAdvancedSearch("   ", async () => null);
    expect(res.hits).toEqual([]);
  });

  it("returns guidance when tokenizable query has no letter tokens", async () => {
    mocks.docs = [doc(1, "https://a.test/x", "A", now)];
    mocks.chunks = [ch(1, 1, "hello")];
    const res = await runAdvancedSearch("@@@", async () => null);
    expect(res.hits).toEqual([]);
    expect(res.evidence).toMatch(/letters or numbers/i);
  });

  it("BM25 path runs when embeddings are missing", async () => {
    mocks.docs = [
      doc(1, "https://a.test/a", "Alpha", now),
      doc(2, "https://b.test/b", "Beta", now),
    ];
    mocks.chunks = [
      ch(1, 1, "kubernetes scheduling guide"),
      ch(2, 2, "unrelated cooking pasta"),
    ];
    const res = await runAdvancedSearch("kubernetes", async () => null);
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
    expect(res.hits[0]!.url).toContain("a.test");
  });

  it("respects maxHits", async () => {
    const dlist: DocumentRecord[] = [];
    const clist: ChunkRecord[] = [];
    for (let i = 1; i <= 6; i++) {
      const u = `https://multi.test/p${i}`;
      dlist.push(doc(i, u, `Page ${i}`, now));
      clist.push(ch(i, i, `alpha keyword unique ${i}`, undefined));
    }
    mocks.docs = dlist;
    mocks.chunks = clist;
    const res = await runAdvancedSearch("alpha keyword", async () => null, {
      maxHits: 2,
      abstainFloor: 0,
    });
    expect(res.hits.length).toBe(2);
  });

  it("person intent ranks a LinkedIn profile above a page that says it employs N people", async () => {
    mocks.docs = [
      doc(1, "https://news.test/hire", "Acme raises a round", now),
      doc(2, "https://www.linkedin.com/in/ada-l/", "Ada Lovelace | LinkedIn", now),
    ];
    mocks.chunks = [
      ch(1, 1, "hive sensors hive sensors hive sensors. Acme now employs 40 people building hive sensors."),
      ch(2, 2, "Ada Lovelace. Lead Research. Years in hive sensors."),
    ];
    const people = await runAdvancedSearch("people who work in hive sensors", async () => null, {
      now,
      abstainFloor: 0,
    });
    expect(people.hits[0]!.url).toContain("linkedin.com/in/");
    const topic = await runAdvancedSearch("hive sensors", async () => null, {
      now,
      abstainFloor: 0,
    });
    expect(topic.hits[0]!.url).toContain("news.test");
  });

  it("uses the injected now for recency instead of the wall clock", async () => {
    const older = now;
    const newer = now + 40 * 86_400_000;
    mocks.docs = [
      doc(1, "https://old.test/a", "Alpha notes", older),
      doc(2, "https://new.test/b", "Alpha notes", newer),
    ];
    mocks.chunks = [
      ch(1, 1, "alpha shared topic text"),
      ch(2, 2, "alpha shared topic text"),
    ];
    const res = await runAdvancedSearch("alpha shared topic", async () => null, {
      now: newer,
      abstainFloor: 0,
    });
    expect(res.hits[0]!.url).toContain("new.test");
  });

  it("time range filters to urls returned by visit log", async () => {
    mocks.docs = [
      doc(1, "https://x.test/in", "In", now),
      doc(2, "https://y.test/out", "Out", now),
    ];
    mocks.chunks = [
      ch(1, 1, "tensorflow basics"),
      ch(2, 2, "tensorflow advanced"),
    ];
    mocks.urlsInRange = new Set(["https://x.test/in"]);
    const res = await runAdvancedSearch("tensorflow", async () => null, {
      forceTimeRange: { start: now - 10_000, end: now + 10_000 },
    });
    expect(res.hits.every((h) => h.url === "https://x.test/in")).toBe(true);
    expect(res.timeWindow).toBe("applied");
    expect(res.timeRelaxed).toBe(false);
  });

  it("abstains when the only in-window page scores under the floor", async () => {
    mocks.docs = [
      doc(1, "https://old.test/topic", "Orbital cargo", now - 40 * 86_400_000),
      doc(2, "https://new.test/other", "Glacier notes", now),
    ];
    mocks.chunks = [
      ch(1, 1, "orbital cargo logistics orbital cargo logistics orbital cargo"),
      ch(2, 2, "a short note about something else"),
    ];
    mocks.urlsInRange = new Set(["https://new.test/other"]);
    const res = await runAdvancedSearch("orbital cargo logistics", async () => null, {
      forceTimeRange: { start: now - 86_400_000, end: now },
      now,
    });
    expect(res.abstained).toBe(true);
    expect(res.hits).toEqual([]);
    expect(res.timeWindow).toBe("applied");
  });

  it("relaxes and says so when the date window has no visits", async () => {
    mocks.docs = [doc(1, "https://old.test/topic", "Orbital cargo", now)];
    mocks.chunks = [ch(1, 1, "orbital cargo logistics details and routes")];
    mocks.urlsInRange = new Set();
    const res = await runAdvancedSearch("orbital cargo logistics", async () => null, {
      forceTimeRange: { start: now - 86_400_000, end: now },
      now,
      abstainFloor: 0,
    });
    expect(res.timeWindow).toBe("relaxed");
    expect(res.timeRelaxed).toBe(true);
    expect(res.hits[0]!.url).toContain("old.test");
    expect(res.evidence).toMatch(/widened/i);
  });

  it("semantic signal can reorder when embeddings exist", async () => {
    const v = new Array(384).fill(0);
    const qv = [...v];
    qv[0] = 1;
    const docVec = [...v];
    docVec[0] = 0.9;
    mocks.docs = [
      doc(1, "https://low.test/", "Low BM25", now),
      doc(2, "https://highsem.test/", "High sem", now),
    ];
    mocks.chunks = [
      ch(1, 1, "zzz unrelated text here", docVec),
      ch(2, 2, "also unrelated", [...v]),
    ];
    const res = await runAdvancedSearch(
      "anything",
      async () => qv,
      { maxHits: 5, abstainFloor: 0 }
    );
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
    const urls = res.hits.map((h) => h.url);
    expect(urls).toContain("https://low.test/");
  });

  it("ranks domain-aligned pages above generic career-only matches", async () => {
    mocks.docs = [
      doc(
        1,
        "https://www.passes.com/",
        "Passes - creators platform",
        now + 86_400_000
      ),
      doc(
        2,
        "https://careers.atriumhealth.org/search",
        "Job Search Results",
        now
      ),
    ];
    mocks.chunks = [
      ch(
        1,
        1,
        "the best decisions in my social media career. supported as a creator on passes."
      ),
      ch(
        2,
        2,
        "Atrium Health career portal job search results for clinical roles."
      ),
    ];
    const res = await runAdvancedSearch(
      "Atrium Health Career Portal Exploration",
      async () => null
    );
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
    expect(res.hits[0]!.url).toContain("atriumhealth");
    const passes = res.hits.find((h) => h.url.includes("passes"));
    const atrium = res.hits.find((h) => h.url.includes("atriumhealth"));
    expect(atrium).toBeDefined();
    if (passes) {
      expect(atrium!.grounding).toBeGreaterThan(passes.grounding);
    }
  });

  it("adaptive cutoff removes very weak scores when stronger docs exist", async () => {
    mocks.docs = [
      doc(1, "https://strong.test/s", "S", now),
      doc(2, "https://weak.test/w", "W", now),
    ];
    mocks.chunks = [
      ch(1, 1, "quantum quantum quantum physics research"),
      ch(2, 2, "sandwich"),
    ];
    const res = await runAdvancedSearch("quantum physics", async () => null);
    expect(res.hits.some((h) => h.url.includes("strong"))).toBe(true);
    expect(res.hits.every((h) => h.score >= 0.028)).toBe(true);
  });
});

describe("abstain floor (Phase 3.3)", () => {
  const now = 1_700_000_000_000;

  beforeEach(() => {
    mocks.docs = [];
    mocks.chunks = [];
    mocks.urlsInRange = new Set();
  });

  it("exports a calibrated default floor", async () => {
    const mod = await import("./search-engine");
    expect(typeof mod.ABSTAIN_FLOOR).toBe("number");
    expect(mod.ABSTAIN_FLOOR).toBeGreaterThan(0);
    expect(mod.ABSTAIN_FLOOR).toBeLessThan(1);
  });

  it("returns no hits, abstained=true and the library message when the best score is under the floor", async () => {
    mocks.docs = [doc(1, "https://a.test/a", "Alpha rockets", now)];
    mocks.chunks = [ch(1, 1, "alpha rockets are fast and loud")];
    const res = await runAdvancedSearch("alpha rockets", async () => null, {
      abstainFloor: 5, // impossible to reach: forces abstain
    });
    expect(res.hits).toEqual([]);
    expect(res.abstained).toBe(true);
    expect(res.evidence).toMatch(/didn't find that in your library/i);
    expect(res.chunks ?? []).toEqual([]);
  });

  it("does not abstain when the best score clears the floor, and never abstains with floor 0", async () => {
    mocks.docs = [doc(1, "https://a.test/a", "Alpha rockets", now)];
    mocks.chunks = [ch(1, 1, "alpha rockets are fast and loud")];
    const strong = await runAdvancedSearch("alpha rockets", async () => null, { abstainFloor: 0.01 });
    expect(strong.hits.length).toBe(1);
    expect(strong.abstained).toBeFalsy();
    const off = await runAdvancedSearch("zzz qqq", async () => null, { abstainFloor: 0 });
    expect(off.abstained).toBeFalsy();
  });
});

describe("chunk kinds in search (Phase 5 task 0.3)", () => {
  const now = 1_700_000_000_000;
  beforeEach(() => {
    mocks.docs = [];
    mocks.chunks = [];
    mocks.urlsInRange = new Set();
  });

  function setup() {
    mocks.docs = [
      doc(1, "https://a.test/notes", "Turbine notes", now),
      doc(2, "https://www.youtube.com/watch?v=abc", "Turbine talk", now - 30 * 86_400_000),
    ];
    mocks.chunks = [
      ch(1, 1, "tidal turbine maintenance windows and blade pitch"),
      {
        ...ch(2, 2, "tidal turbine maintenance windows and blade pitch"),
        kind: "transcript",
        locator: { videoId: "abc", startSec: 60, endSec: 120 },
      },
    ];
  }

  it("without intent words the newer text page ranks first (kinds ignored)", async () => {
    setup();
    const res = await runAdvancedSearch("tidal turbine blade pitch", async () => null, { abstainFloor: 0 });
    expect(res.hits[0].url).toBe("https://a.test/notes");
    expect(res.hits[0].kind).toBe("text");
  });

  it("with a video intent the transcript chunk wins and the hit carries kind and locator", async () => {
    setup();
    const res = await runAdvancedSearch("video about tidal turbine blade pitch", async () => null, { abstainFloor: 0 });
    expect(res.hits[0].url).toBe("https://www.youtube.com/watch?v=abc");
    expect(res.hits[0].kind).toBe("transcript");
    expect(res.hits[0].locator).toEqual({ videoId: "abc", startSec: 60, endSec: 120 });
  });
});

describe("highlight boost (Phase 5.3)", () => {
  const now = 1_700_000_000_000;
  beforeEach(() => {
    mocks.docs = [];
    mocks.chunks = [];
    mocks.urlsInRange = new Set();
  });

  it("a saved highlight outranks the same text in a plain page chunk (no intent words needed)", async () => {
    mocks.docs = [
      doc(1, "https://a.test/plain", "Notes A", now),
      doc(2, "https://b.test/highlighted", "Notes B", now - 5 * 86_400_000),
    ];
    mocks.chunks = [
      ch(1, 1, "slack tide is the best time to service tidal turbines"),
      { ...ch(2, 2, "slack tide is the best time to service tidal turbines"), kind: "highlight", locator: { quote: "slack tide" } },
    ];
    const res = await runAdvancedSearch("service tidal turbines slack tide", async () => null, { abstainFloor: 0 });
    expect(res.hits[0].url).toBe("https://b.test/highlighted");
    expect(res.hits[0].kind).toBe("highlight");
  });
});

describe("collection scope (Phase 5.4)", () => {
  const now = 1_700_000_000_000;
  beforeEach(() => {
    mocks.docs = [];
    mocks.chunks = [];
    mocks.urlsInRange = new Set();
    mocks.collectionItems = [];
  });

  it("returns only documents in the chosen collection", async () => {
    mocks.docs = [
      doc(1, "https://a.test/", "Kombucha pH log", now),
      doc(2, "https://b.test/", "Kombucha bottling", now),
      doc(3, "https://c.test/", "Kombucha sugar", now),
    ];
    mocks.chunks = [
      ch(1, 1, "kombucha fermentation ph curve"),
      ch(2, 2, "kombucha fermentation bottling line"),
      ch(3, 3, "kombucha fermentation sugar ratio"),
    ];
    mocks.collectionItems = [
      { collectionId: 7, documentId: 2 },
      { collectionId: 7, documentId: 3 },
      { collectionId: 8, documentId: 1 },
    ];
    const all = await runAdvancedSearch("kombucha fermentation", async () => null, { abstainFloor: 0 });
    expect(all.hits.map((h) => h.url).sort()).toEqual(["https://a.test/", "https://b.test/", "https://c.test/"]);
    const scoped = await runAdvancedSearch("kombucha fermentation", async () => null, { abstainFloor: 0, collectionId: 7 });
    expect(scoped.hits.map((h) => h.url).sort()).toEqual(["https://b.test/", "https://c.test/"]);
    const empty = await runAdvancedSearch("kombucha fermentation", async () => null, { abstainFloor: 0, collectionId: 99 });
    expect(empty.hits).toEqual([]);
    expect(empty.evidence).toBe("This collection has no pages yet.");
  });
});
