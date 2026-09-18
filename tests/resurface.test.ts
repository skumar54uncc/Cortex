import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db/schema";
import {
  shouldResurface,
  dayKey,
  pruneShownMap,
  findMostSimilarDocument,
  RESURFACE_THRESHOLD,
} from "../src/lib/resurface";

const base = {
  enabled: true,
  similarity: 0.9,
  currentUrl: "https://a.test/new",
  matchUrl: "https://b.test/old",
  sensitive: false,
  lastShownDay: undefined as string | undefined,
  today: "2026-09-18",
};

describe("shouldResurface", () => {
  it("shows for a strong match on a normal page the first time today", () => {
    expect(shouldResurface(base)).toBe(true);
  });

  it("is off unless the user turned it on", () => {
    expect(shouldResurface({ ...base, enabled: false })).toBe(false);
  });

  it("needs similarity at or above the threshold", () => {
    expect(RESURFACE_THRESHOLD).toBeGreaterThanOrEqual(0.8);
    expect(shouldResurface({ ...base, similarity: RESURFACE_THRESHOLD })).toBe(true);
    expect(shouldResurface({ ...base, similarity: RESURFACE_THRESHOLD - 0.001 })).toBe(false);
  });

  it("never on sensitive sites and never pointing at the same page", () => {
    expect(shouldResurface({ ...base, sensitive: true })).toBe(false);
    expect(shouldResurface({ ...base, matchUrl: "https://a.test/new#frag" })).toBe(false);
  });

  it("at most once per page per day", () => {
    expect(shouldResurface({ ...base, lastShownDay: "2026-09-18" })).toBe(false);
    expect(shouldResurface({ ...base, lastShownDay: "2026-09-17" })).toBe(true);
  });
});

describe("shown-map bookkeeping", () => {
  it("dayKey is the local calendar day", () => {
    expect(dayKey(new Date(2026, 8, 18, 23, 59).getTime())).toBe("2026-09-18");
    expect(dayKey(new Date(2026, 8, 19, 0, 1).getTime())).toBe("2026-09-19");
  });

  it("prune keeps only today's entries and caps the size", () => {
    const map: Record<string, string> = { a: "2026-09-17", b: "2026-09-18" };
    for (let i = 0; i < 700; i++) map[`u${i}`] = "2026-09-18";
    const out = pruneShownMap(map, "2026-09-18");
    expect(out.a).toBeUndefined();
    expect(out.b).toBe("2026-09-18");
    expect(Object.keys(out).length).toBeLessThanOrEqual(500);
  });
});

describe("findMostSimilarDocument", () => {
  const unit = (v: number[]) => {
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  };

  beforeEach(async () => {
    for (const t of db.tables) await t.clear();
  });

  async function addDoc(url: string, vecs: number[][]): Promise<number> {
    const id = (await db.documents.add({ url, domain: new URL(url).hostname, title: `T ${url}`, summary: "", lastVisitedAt: 1, visitCount: 1, importanceScore: 0.1 })) as number;
    for (const [i, v] of vecs.entries()) {
      await db.chunks.add({ documentId: id, ord: i, text: "t", embedding: unit(v), embedState: "embedded" });
    }
    return id;
  }

  it("returns the most similar other document with its score, excluding the page itself", async () => {
    const current = await addDoc("https://a.test/new", [[1, 0, 0]]);
    await addDoc("https://b.test/close", [[0.95, 0.3, 0]]);
    await addDoc("https://c.test/far", [[0, 1, 0]]);
    const best = await findMostSimilarDocument(current);
    expect(best?.url).toBe("https://b.test/close");
    expect(best!.similarity).toBeGreaterThan(0.9);
    expect(best!.title).toBe("T https://b.test/close");
  });

  it("returns null when the page has no embeddings yet or there is nothing else", async () => {
    const lonely = await addDoc("https://a.test/only", [[1, 0, 0]]);
    expect(await findMostSimilarDocument(lonely)).toBeNull();
    const noEmb = (await db.documents.add({ url: "https://x.test/", domain: "x.test", title: "x", summary: "", lastVisitedAt: 1, visitCount: 1, importanceScore: 0 })) as number;
    expect(await findMostSimilarDocument(noEmb)).toBeNull();
  });
});
