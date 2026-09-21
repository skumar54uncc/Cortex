import { describe, it, expect } from "vitest";
import { parseRecallQuery, buildRecallAnswer, type RecallPage } from "../src/lib/chat/recall";

/**
 * "What did I see on YouTube today?" is a recall question, not a search over
 * passages. Answering it from snippets made the model say it had nothing
 * even though 20 sources were retrieved. These questions are answered from
 * the visit record instead.
 */
const DAY = 86_400_000;
const NOW = Date.parse("2026-09-20T18:00:00Z");

describe("parseRecallQuery", () => {
  it("recognises what did I see / watch / read, with a site and a period", () => {
    expect(parseRecallQuery("what did I see on Youtube tody? Give me Keytakeaways front hem", NOW)).toMatchObject({
      site: "youtube",
      range: "today",
    });
    expect(parseRecallQuery("what did I watch yesterday", NOW)).toMatchObject({ range: "yesterday" });
    expect(parseRecallQuery("what have I been reading on linkedin.com this week", NOW)).toMatchObject({
      site: "linkedin.com",
      range: "week",
    });
    expect(parseRecallQuery("summarise what I read today", NOW)).toMatchObject({ range: "today" });
    expect(parseRecallQuery("what did I browse on amazon.in", NOW)).toMatchObject({ site: "amazon.in" });
  });

  it("leaves real questions to normal search", () => {
    for (const q of [
      "what is the boiling point of nitrogen",
      "who did I view from PolyWise",
      "fluxgate recalibration drift",
      "what did the glacier survey find",
    ]) {
      expect(parseRecallQuery(q, NOW)).toBeNull();
    }
  });

  it("gives a time window that matches the period", () => {
    const today = parseRecallQuery("what did I read today", NOW)!;
    expect(NOW - today.since).toBeLessThanOrEqual(DAY);
    const week = parseRecallQuery("what did I read this week", NOW)!;
    expect(Math.round((NOW - week.since) / DAY)).toBe(7);
  });
});

describe("buildRecallAnswer", () => {
  const pages: RecallPage[] = [
    { url: "https://www.youtube.com/watch?v=a", title: "How microchips are made", domain: "www.youtube.com", visitedAt: NOW - 3600_000, summary: "Wafer lithography explained" },
    { url: "https://www.youtube.com/watch?v=b", title: "Insect robots from Harvard", domain: "www.youtube.com", visitedAt: NOW - 7200_000, summary: "" },
    { url: "https://www.youtube.com/watch?v=c", title: "Shakira live", domain: "www.youtube.com", visitedAt: NOW - 9000_000, summary: "" },
    { url: "https://www.amazon.in/dp/x", title: "Foot massager", domain: "www.amazon.in", visitedAt: NOW - 1000, summary: "" },
  ];

  it("answers site by site, names the pages, and counts them", () => {
    const out = buildRecallAnswer({ site: null, range: "today", since: NOW - DAY, label: "today" }, pages);
    expect(out.text).toContain("4 pages");
    expect(out.text).toContain("www.youtube.com");
    expect(out.text).toContain("How microchips are made");
    expect(out.text).not.toContain("—");
    // Every named page is citable, so the panel can link it.
    expect(out.sources.map((s) => s.url)).toContain("https://www.youtube.com/watch?v=a");
  });

  it("narrows to one site when the question named one", () => {
    const out = buildRecallAnswer({ site: "youtube", range: "today", since: NOW - DAY, label: "today" }, pages);
    expect(out.text).toContain("3 pages");
    expect(out.text).not.toContain("amazon");
    expect(out.sources).toHaveLength(3);
  });

  it("says so plainly when the period is empty", () => {
    const out = buildRecallAnswer({ site: "youtube", range: "today", since: NOW - DAY, label: "today" }, []);
    expect(out.text).toContain("nothing");
    expect(out.sources).toEqual([]);
  });
});
