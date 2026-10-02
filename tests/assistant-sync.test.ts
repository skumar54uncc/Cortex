// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { captureFinalizedVisit } from "../src/assistant-sync/capture";
import { CANONICAL_QUERY_ALLOWLIST, canonicalizeUrl } from "../src/assistant-sync/canonical-url";
import { dailySummary } from "../src/assistant-sync/daily-summary";
import { assistantSyncDb, setDriveFolderTrashHandler, wipeAssistantSyncOnLocalDelete } from "../src/assistant-sync/db";
import { documentHasPasswordInput, syncDenyReason } from "../src/assistant-sync/denylist";
import { buildExcerpt } from "../src/assistant-sync/excerpt";
import { howFoundFromReferrer } from "../src/assistant-sync/linkedin-selectors";
import { linkedInSyncRow } from "../src/assistant-sync/linkedin-sync";
import { localVisitStamp } from "../src/assistant-sync/local-time";
import { pageTypeForUrl } from "../src/assistant-sync/page-type";
import { redactForSync } from "../src/assistant-sync/redact-sync";
import { parseSearchQuery } from "../src/assistant-sync/search-capture";
import { TOPIC_CATALOG } from "../src/assistant-sync/topic-catalog";
import { tagTopics } from "../src/assistant-sync/topics";
import { forgetAll } from "../src/lib/data-controls";

const NOW = Date.parse("2026-10-02T15:30:00.000Z");

function visit(overrides: Partial<Parameters<typeof captureFinalizedVisit>[0]> = {}) {
  return captureFinalizedVisit({
    id: "v1",
    visitedAt: NOW,
    title: "Pinecone pricing",
    url: "https://www.example.com/blog/pinecone?utm=1#top",
    dwellMinutes: null,
    maxScrollPct: null,
    pageText: null,
    pageEmbedding: null,
    hasPasswordInput: false,
    userDenylist: [],
    referrer: null,
    linkedInDocument: null,
    syncEnabled: true,
    ...overrides,
  });
}

beforeEach(async () => {
  setDriveFolderTrashHandler(async () => {});
  await assistantSyncDb.visits.clear();
  await assistantSyncDb.content.clear();
  await assistantSyncDb.searches.clear();
  await assistantSyncDb.people.clear();
  await assistantSyncDb.companies.clear();
});

describe("canonical url", () => {
  it("keeps only the allowlisted query keys and drops the fragment", () => {
    expect([...CANONICAL_QUERY_ALLOWLIST]).toEqual(["q", "query", "search_query", "v"]);
    expect(canonicalizeUrl("https://WWW.YouTube.com/watch?v=abc&t=10&feature=share#t")).toBe(
      "https://www.youtube.com/watch?v=abc"
    );
    expect(canonicalizeUrl("https://www.google.com/search?q=pinecone&sca_esv=1&hl=en")).toBe(
      "https://www.google.com/search?q=pinecone"
    );
    expect(canonicalizeUrl("chrome://settings")).toBeNull();
  });
});

describe("page type", () => {
  it("classifies the spec kinds from the url", () => {
    expect(pageTypeForUrl("https://medium.com/p/hello")).toBe("Article");
    expect(pageTypeForUrl("https://developer.mozilla.org/en-US/docs/Web")).toBe("Docs");
    expect(pageTypeForUrl("https://www.youtube.com/watch?v=abc")).toBe("Video");
    expect(pageTypeForUrl("https://www.allrecipes.com/recipe/1/soup")).toBe("Recipe");
    expect(pageTypeForUrl("https://www.nytimes.com/2026/01/01/world.html")).toBe("News");
    expect(pageTypeForUrl("https://www.linkedin.com/jobs/view/1")).toBe("Job post");
    expect(pageTypeForUrl("https://github.com/cortex/memory")).toBe("Repo");
    expect(pageTypeForUrl("https://news.ycombinator.com/item?id=1")).toBe("Forum");
    expect(pageTypeForUrl("https://www.amazon.com/dp/B00")).toBe("Shopping");
    expect(pageTypeForUrl("https://www.linkedin.com/feed/")).toBe("Feed");
    expect(pageTypeForUrl("https://www.figma.com/file/abc")).toBe("App");
    expect(pageTypeForUrl("https://www.google.com/search?q=pinecone")).toBe("Utility");
    expect(pageTypeForUrl("https://example.com/about")).toBe("Other");
  });
});

describe("denylist", () => {
  it("blocks sensitive hosts, local pages, browser pages, user domains, and password fields", () => {
    expect(syncDenyReason("https://www.chase.com/login")).toBe("sensitive");
    expect(syncDenyReason("https://mail.google.com/mail")).toBe("sensitive");
    expect(syncDenyReason("https://localhost:3000/app")).toBe("local");
    expect(syncDenyReason("chrome://settings")).toBe("browser");
    expect(syncDenyReason("https://example.com/", { userDomains: ["example.com"] })).toBe("user");
    expect(syncDenyReason("https://example.com/article", { hasPasswordInput: true })).toBe("password");
    expect(syncDenyReason("https://example.com/article")).toBeNull();
    expect(documentHasPasswordInput({ querySelector: () => ({}) })).toBe(true);
    expect(documentHasPasswordInput({ querySelector: () => null })).toBe(false);
  });
});

describe("sync redaction", () => {
  it("removes emails, phones, and 13 to 19 digit sequences", () => {
    const out = redactForSync(
      "Mail ada@example.com or call (415) 555-1212. Card 4111 1111 1111 1111. Year 2026."
    );
    expect(out).not.toContain("ada@example.com");
    expect(out).not.toContain("415");
    expect(out).not.toContain("4111");
    expect(out).toContain("2026");
    expect(out).toContain("[redacted]");
  });
});

describe("search capture", () => {
  it("reads a query from each supported engine", () => {
    expect(parseSearchQuery("https://www.google.com/search?q=pinecone+pricing")).toEqual({
      engine: "Google",
      query: "pinecone pricing",
    });
    expect(parseSearchQuery("https://www.bing.com/search?q=rag")).toEqual({ engine: "Bing", query: "rag" });
    expect(parseSearchQuery("https://duckduckgo.com/?q=agents")).toEqual({ engine: "DuckDuckGo", query: "agents" });
    expect(parseSearchQuery("https://www.youtube.com/results?search_query=tesla+factory")).toEqual({
      engine: "YouTube",
      query: "tesla factory",
    });
    expect(parseSearchQuery("https://www.linkedin.com/search/results/people/?keywords=recruiters")).toEqual({
      engine: "LinkedIn",
      query: "recruiters",
    });
    expect(parseSearchQuery("https://www.google.com/travel/flights?q=SFO%20to%20BOS")).toEqual({
      engine: "Google Flights",
      query: "SFO to BOS",
    });
    expect(parseSearchQuery("https://www.google.com/travel/flights/search?tfs=opaque")).toBeNull();
    expect(parseSearchQuery("https://www.youtube.com/watch?v=abc")).toBeNull();
  });
});

describe("excerpt", () => {
  it("requires a known dwell of at least 5 minutes and caps the text", () => {
    expect(buildExcerpt("hello world", null)).toBeNull();
    expect(buildExcerpt("hello world", 4.9)).toBeNull();
    expect(buildExcerpt("  hello   world  ", 5)).toBe("hello world");
    const long = `${"word ".repeat(400)}end`;
    const excerpt = buildExcerpt(long, 12);
    expect(excerpt).not.toBeNull();
    expect(excerpt!.length).toBeLessThanOrEqual(1500);
    expect(excerpt!.endsWith(" ")).toBe(false);
  });
});

describe("topics", () => {
  it("lists 40 labels and returns at most three above the threshold", () => {
    expect(new Set(TOPIC_CATALOG.map((t) => t.label)).size).toBe(40);
    expect(tagTopics(null)).toEqual([]);
    const labels = [
      { label: "RAG", vector: [1, 0, 0] },
      { label: "LLMs", vector: [0, 1, 0] },
      { label: "Python", vector: [0, 0, 1] },
      { label: "Tesla", vector: [0.8, 0.8, 0] },
    ];
    const labelsWithFourth = [...labels, { label: "GitHub", vector: [0.7, 0.7, 0] }];
    const tagged = tagTopics([1, 0.9, 0], 0.5, labelsWithFourth);
    expect(tagged).toHaveLength(3);
    expect(tagged).not.toContain("Python");
  });
});

describe("daily summary", () => {
  it("omits blank dwell, company, searches, and topics", () => {
    expect(
      dailySummary({
        profiles: [
          { name: "Ada", company: "Tesla" },
          { name: "Ben", company: "" },
        ],
        searches: ["flights to SFO", "pinecone"],
        longestRead: { title: "Pinecone pricing", dwellMinutes: 12 },
        topics: ["vector databases", "Tesla", "flights and travel", "RAG", "extra"],
      })
    ).toBe(
      "Viewed Ada (Tesla), Ben. Searched for flights to SFO, pinecone. Longest read was Pinecone pricing, 12 minutes. Topics: vector databases, Tesla, flights and travel, RAG."
    );
    expect(
      dailySummary({
        profiles: [],
        searches: [],
        longestRead: { title: "Notes", dwellMinutes: null },
        topics: [],
      })
    ).toBe("Nothing recorded for this day.");
  });
});

describe("local time", () => {
  it("formats a pinned instant in an IANA zone", () => {
    expect(localVisitStamp(NOW, "America/New_York")).toEqual({
      date: "2026-10-02",
      weekday: "Friday",
      time: "11:30",
    });
  });
});

describe("linkedin sync", () => {
  it("keeps name, headline, and company when the referrer is unknown", () => {
    const html = readFileSync(join(__dirname, "fixtures", "linkedin", "profile.html"), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const row = linkedInSyncRow(doc, "https://www.linkedin.com/in/mira-okafor-lind-12ab/", null);
    expect(row?.kind).toBe("person");
    if (row?.kind !== "person") return;
    expect(row.person.name).toBe("Mira Okafor-Lind");
    expect(row.person.company).toBe("Tidora");
    expect(row.person.howFound).toBe("");
    expect(row.person).not.toHaveProperty("photoUrl");
    expect(howFoundFromReferrer("https://www.linkedin.com/search/results/people/?keywords=tidora")).toBe("search");
    expect(howFoundFromReferrer("https://www.linkedin.com/feed/")).toBe("feed");
    expect(howFoundFromReferrer("https://www.linkedin.com/in/other/?trk=public_profile_browsemap")).toBe(
      "people also viewed"
    );
    expect(howFoundFromReferrer("")).toBe("");
  });

  it("reads a company section and captures nothing when the profile has no name", () => {
    const company = readFileSync(join(__dirname, "fixtures", "linkedin", "company.html"), "utf8");
    const doc = new DOMParser().parseFromString(company, "text/html");
    const row = linkedInSyncRow(doc, "https://www.linkedin.com/company/tidora/people/", null);
    expect(row).toEqual({
      kind: "company",
      company: {
        company: "Tidora",
        sectionViewed: "People",
        linkedinUrl: "https://www.linkedin.com/company/tidora/",
      },
    });
    const feed = readFileSync(join(__dirname, "fixtures", "linkedin", "feed.html"), "utf8");
    const blank = new DOMParser().parseFromString(feed, "text/html");
    expect(linkedInSyncRow(blank, "https://www.linkedin.com/feed/", "https://www.linkedin.com/feed/")).toBeNull();
  });
});

describe("capture", () => {
  it("writes nothing while sync is off or the page is denied", async () => {
    expect((await visit({ syncEnabled: false })).stored).toBe(false);
    expect(await assistantSyncDb.visits.count()).toBe(0);
    expect((await visit({ hasPasswordInput: true })).stored).toBe(false);
    expect(await assistantSyncDb.visits.count()).toBe(0);
  });

  it("stores a visit once, skips excerpts when dwell is unknown, and redacts the title", async () => {
    const first = await visit({
      title: "Mail ada@example.com",
      pageText: "A long article about pinecone pricing and indexes.",
      dwellMinutes: null,
    });
    expect(first.stored).toBe(true);
    await visit({
      title: "Mail ada@example.com",
      pageText: "A long article about pinecone pricing and indexes.",
      dwellMinutes: 8,
    });
    expect(await assistantSyncDb.visits.count()).toBe(1);
    const row = await assistantSyncDb.visits.get("v1");
    expect(row?.title).toBe("Mail [redacted]");
    expect(row?.url).toBe("https://www.example.com/blog/pinecone");
    expect(row?.dwellMinutes).toBe(8);
    expect(row?.pageType).toBe("Article");
    const content = await assistantSyncDb.content.get("v1");
    expect(content?.excerpt).toContain("pinecone");
  });

  it("does not invent an excerpt for a pre sync row with blank dwell", async () => {
    await visit({ id: "old", pageText: "x".repeat(2000), dwellMinutes: null });
    expect(await assistantSyncDb.content.get("old")).toBeUndefined();
  });

  it("stores a search and leaves how_found blank", async () => {
    await visit({
      id: "s1",
      url: "https://www.google.com/search?q=who+works+at+tesla&hl=en",
    });
    expect(await assistantSyncDb.searches.get("s1")).toMatchObject({
      engine: "Google",
      query: "who works at tesla",
    });
  });
});

describe("local delete", () => {
  it("wipes the sync database and calls the Drive trash hook", async () => {
    await visit();
    let trashed = 0;
    setDriveFolderTrashHandler(async () => {
      trashed += 1;
    });
    await forgetAll();
    expect(await assistantSyncDb.visits.count()).toBe(0);
    expect(trashed).toBe(1);
    trashed = 0;
    await wipeAssistantSyncOnLocalDelete();
    expect(trashed).toBe(1);
  });
});
