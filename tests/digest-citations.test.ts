import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  DIGEST_SYSTEM_PROMPT,
  buildDigestPrompt,
  buildDigestSources,
  groupSourcesByDomain,
  parseDigestOutput,
} from "../src/lib/chat/digest-engine";
import {
  digestCacheKey,
  getDigestFromCache,
  saveDigestToCache,
} from "../src/lib/chat/digest-cache";
import {
  DIGEST_SCHEMA_VERSION,
  type DigestResult,
} from "../src/lib/chat/digest-types";
import { db } from "../src/db/schema";
import type { ChunkWithDoc } from "../src/lib/search-engine";

const NOW = Date.parse("2026-09-18T12:00:00Z");

function chunk(
  i: number,
  over: Partial<{ url: string; domain: string; title: string; importanceScore: number }> = {}
): ChunkWithDoc {
  const domain = over.domain ?? "ex.test";
  return {
    id: i,
    documentId: i,
    ord: 0,
    text: `body ${i}`,
    document: {
      id: i,
      url: over.url ?? `https://${domain}/p${i}`,
      domain,
      title: over.title ?? `Title ${i}`,
      summary: "",
      lastVisitedAt: NOW - i * 1000,
      visitCount: 1,
      importanceScore: over.importanceScore ?? 0.5,
    },
  };
}

function chunks(n: number): ChunkWithDoc[] {
  return Array.from({ length: n }, (_, i) => chunk(i + 1));
}

const RANGE = { from: new Date(NOW - 86_400_000), to: new Date(NOW) };

describe("digest prompt", () => {
  it("numbers every source and prints title, domain and url", () => {
    const prompt = buildDigestPrompt(
      [
        chunk(1, { domain: "linkedin.com", title: "Jane Doe" }),
        chunk(2, { domain: "news.ycombinator.com", title: "Thread" }),
      ],
      RANGE
    );
    expect(prompt).toContain('[1] "Jane Doe" (linkedin.com');
    expect(prompt).toContain("URL: https://linkedin.com/p1");
    expect(prompt).toContain('[2] "Thread" (news.ycombinator.com');
  });

  it("asks for inline [N] citations and site-named copy", () => {
    expect(DIGEST_SYSTEM_PROMPT).toMatch(/\[N\]/);
    expect(DIGEST_SYSTEM_PROMPT.toLowerCase()).toContain("cite");
    // "On linkedin.com you read 3 profiles [1][2][3]"
    expect(DIGEST_SYSTEM_PROMPT).toMatch(/On [a-z.]+ you/i);
  });

  it("passes per-site counts with example source numbers", () => {
    const prompt = buildDigestPrompt(
      [
        chunk(1, { domain: "linkedin.com" }),
        chunk(2, { domain: "linkedin.com" }),
        chunk(3, { domain: "amazon.com" }),
      ],
      RANGE
    );
    expect(prompt).toContain("linkedin.com: 2 pages [1][2]");
    expect(prompt).toContain("amazon.com: 1 page [3]");
  });

  it("uses no em dash", () => {
    expect(DIGEST_SYSTEM_PROMPT).not.toContain("—");
    expect(buildDigestPrompt(chunks(2), RANGE)).not.toContain("—");
  });
});

describe("buildDigestSources", () => {
  it("numbers from 1 and keeps numbering contiguous after dropping unsafe urls", () => {
    const list = [
      chunk(1, { url: "https://a.test/one" }),
      chunk(2, { url: "javascript:alert(1)" }),
      chunk(3, { url: "https://c.test/three" }),
    ];
    const sources = buildDigestSources(list);
    expect(sources.map((s) => s.n)).toEqual([1, 2]);
    expect(sources.map((s) => s.url)).toEqual([
      "https://a.test/one",
      "https://c.test/three",
    ]);
  });

  it("trims and caps titles without HTML escaping them", () => {
    const long = "x".repeat(400);
    const sources = buildDigestSources([
      chunk(1, { title: `  Ben & Jerry's <b>deal</b>  ` }),
      chunk(2, { title: long }),
    ]);
    expect(sources[0]!.title).toBe("Ben & Jerry's <b>deal</b>");
    expect(sources[1]!.title.length).toBeLessThanOrEqual(161);
  });
});

describe("groupSourcesByDomain", () => {
  it("counts pages per domain with example source indexes, busiest first", () => {
    const sources = buildDigestSources([
      chunk(1, { domain: "linkedin.com" }),
      chunk(2, { domain: "amazon.com" }),
      chunk(3, { domain: "linkedin.com" }),
      chunk(4, { domain: "linkedin.com" }),
    ]);
    const groups = groupSourcesByDomain(sources);
    expect(groups[0]).toMatchObject({
      domain: "linkedin.com",
      count: 3,
      sourceIndexes: [1, 3, 4],
    });
    expect(groups[1]).toMatchObject({ domain: "amazon.com", count: 1, sourceIndexes: [2] });
  });
});

describe("parseDigestOutput citations", () => {
  it("maps [N] in each narrative sentence to source indexes", () => {
    const list = [
      chunk(1, { domain: "linkedin.com" }),
      chunk(2, { domain: "linkedin.com" }),
      chunk(3, { domain: "amazon.com" }),
    ];
    const raw = `
NARRATIVE: Your recent reading focused on hiring. On linkedin.com you read 2 profiles [1][2]. On amazon.com you compared one deal [3].

TOPICS:
- Hiring (2 pages)

INSIGHTS:
- Jane leads support ops [1]
`;
    const p = parseDigestOutput(raw, list);
    expect(p.narrativeParts).toHaveLength(3);
    expect(p.narrativeParts[0]!.sourceIndexes).toEqual([]);
    expect(p.narrativeParts[1]!.sourceIndexes).toEqual([1, 2]);
    expect(p.narrativeParts[2]!.sourceIndexes).toEqual([3]);
    expect(p.citationsFromModel).toBe(true);
    // Markers are stripped from the rendered copy.
    expect(p.narrative).not.toMatch(/\[\d+\]/);
    expect(p.narrative).toContain("On linkedin.com you read 2 profiles.");
    expect(p.sources.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(p.insights[0]!.sourceIndexes).toEqual([1]);
  });

  it("accepts grouped citations like [1, 2] and strips stray markdown", () => {
    const raw = `
**NARRATIVE:** You read *two* things about \`servers\` [1, 2].

TOPICS:
- **Servers** (2 pages)
`;
    const p = parseDigestOutput(raw, chunks(2));
    expect(p.narrativeParts[0]!.sourceIndexes).toEqual([1, 2]);
    expect(p.narrative).not.toContain("**");
    expect(p.narrative).not.toContain("`");
    expect(p.topics[0]!.topic).toBe("Servers");
  });

  it("ignores out-of-range and malformed [N] without throwing", () => {
    const list = chunks(2);
    const raw = `
NARRATIVE: You read a thing [99]. You read another [abc]. You read a third [2].

INSIGHTS:
- out of range [42]
- fine [2]
`;
    expect(() => parseDigestOutput(raw, list)).not.toThrow();
    const p = parseDigestOutput(raw, list);
    expect(p.narrativeParts[0]!.sourceIndexes).toEqual([]);
    expect(p.narrativeParts[2]!.sourceIndexes).toEqual([2]);
    expect(p.narrative).not.toContain("[99]");
    expect(p.insights.map((i) => i.text)).toEqual(["fine"]);
    for (const part of p.narrativeParts) {
      for (const n of part.sourceIndexes) {
        expect(p.sources.some((s) => s.n === n)).toBe(true);
      }
    }
  });

  it("never throws on empty or junk input", () => {
    expect(() => parseDigestOutput("", chunks(1))).not.toThrow();
    expect(() => parseDigestOutput("]][[1]", chunks(1))).not.toThrow();
    expect(() => parseDigestOutput("NARRATIVE:", [])).not.toThrow();
    const p = parseDigestOutput("NARRATIVE:", []);
    expect(p.sources).toEqual([]);
    expect(Array.isArray(p.narrativeParts)).toBe(true);
    expect(Array.isArray(p.domainGroups)).toBe(true);
  });

  it("falls back to top sources by importance when the model cites nothing", () => {
    const list = [
      chunk(1, { domain: "a.test", importanceScore: 0.9 }),
      chunk(2, { domain: "b.test", importanceScore: 0.8 }),
      chunk(3, { domain: "c.test", importanceScore: 0.7 }),
    ];
    const raw = `
NARRATIVE: You read about hiring. You also looked at deals.

INSIGHTS:
- Support ops roles are open
`;
    const p = parseDigestOutput(raw, list);
    expect(p.citationsFromModel).toBe(false);
    expect(p.narrativeParts).toHaveLength(2);
    for (const part of p.narrativeParts) {
      expect(part.sourceIndexes.length).toBeGreaterThan(0);
    }
    expect(p.narrativeParts[0]!.sourceIndexes).toContain(1);
    // Uncited insight bullets survive with a named link instead of vanishing.
    expect(p.insights).toHaveLength(1);
    expect(p.insights[0]!.sourceIndexes).toEqual([1]);
    expect(p.insights[0]!.sourceUrl).toBe("https://a.test/p1");
  });

  it("keeps every emitted url http or https", () => {
    const list = [
      chunk(1, { url: "javascript:alert(1)" }),
      chunk(2, { url: "https://ok.test/p2" }),
    ];
    const p = parseDigestOutput("NARRATIVE: You read one page [1].", list);
    for (const s of p.sources) expect(s.url).toMatch(/^https?:\/\//);
    for (const i of p.insights) expect(i.sourceUrl).toMatch(/^https?:\/\//);
  });
});

describe("digest cache versioning", () => {
  beforeEach(async () => {
    await db.digestCache.clear();
  });

  it("keys cached digests by schema version", () => {
    expect(digestCacheKey("today")).toContain(String(DIGEST_SCHEMA_VERSION));
    expect(digestCacheKey("today")).not.toBe("today");
  });

  it("ignores digests cached before the citation shape existed", async () => {
    await db.digestCache.put({
      range: "today",
      generatedAt: NOW,
      resultJson: JSON.stringify({ range: "today", narrative: "old", sources: [] }),
    });
    expect(await getDigestFromCache("today")).toBeUndefined();
  });

  it("round-trips a current digest", async () => {
    const result: DigestResult = {
      schemaVersion: DIGEST_SCHEMA_VERSION,
      range: "today",
      generatedAt: NOW,
      pageCount: 1,
      domainsCount: 1,
      narrative: "You read one page.",
      narrativeParts: [{ text: "You read one page.", sourceIndexes: [1] }],
      topics: [],
      insights: [],
      sources: [
        { n: 1, url: "https://ok.test/p1", title: "P1", domain: "ok.test", visitedAt: NOW },
      ],
      domainGroups: [{ domain: "ok.test", count: 1, sourceIndexes: [1] }],
      citationsFromModel: true,
    };
    await saveDigestToCache("today", result);
    const back = await getDigestFromCache("today");
    expect(back?.narrativeParts[0]!.sourceIndexes).toEqual([1]);
    expect(back?.range).toBe("today");
  });
});
