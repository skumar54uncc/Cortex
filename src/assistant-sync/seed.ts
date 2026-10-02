import type { SyncCompanyRecord, SyncContentRecord, SyncPersonRecord, SyncSearchRecord, SyncVisitRecord } from "./db";
import { buildWorkbook, SEED_SHEET_NAME, type Workbook } from "./sheet";

export const SEED_DAYS = 90;
export const SEED_VISITS_PER_WEEKDAY = 150;

const TITLES = [
  "Pinecone index notes",
  "Bay Area rental listings",
  "Tesla factory update",
  "Chrome extension permissions",
  "Weeknight chicken recipe",
];

export interface SeedOptions {
  days?: number;
  visitsPerWeekday?: number;
  now?: number;
  timeZone?: string;
  syncedAt?: string;
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function weekdayIndex(ms: number, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(ms));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** Deterministic fake history. Needles are fixed ids an assistant recall test can ask for. */
export function buildSeed(opts: SeedOptions = {}): { workbook: Workbook; needles: string[] } {
  const days = opts.days ?? SEED_DAYS;
  const perWeekday = opts.visitsPerWeekday ?? SEED_VISITS_PER_WEEKDAY;
  const now = opts.now ?? Date.parse("2026-10-02T16:00:00.000Z");
  const timeZone = opts.timeZone ?? "America/New_York";
  const syncedAt = opts.syncedAt ?? "2026-10-02 12:00";
  const random = rng(3);
  const visits: SyncVisitRecord[] = [];
  const content: SyncContentRecord[] = [];
  const searches: SyncSearchRecord[] = [];
  const people: SyncPersonRecord[] = [];
  const companies: SyncCompanyRecord[] = [];

  for (let day = days; day >= 1; day--) {
    const visitedAt = now - day * 86_400_000;
    const dow = weekdayIndex(visitedAt, timeZone);
    const count = dow === 0 || dow === 6 ? Math.max(1, Math.round(perWeekday / 5)) : perWeekday;
    for (let n = 0; n < count; n++) {
      const id = `seed-${day}-${n}`;
      const title = TITLES[Math.floor(random() * TITLES.length)] ?? "Notes";
      visits.push({
        id,
        visitedAt: visitedAt + n * 60_000,
        title,
        url: `https://example.com/notes/${id}`,
        domain: "example.com",
        dwellMinutes: n % 17 === 0 ? 8 : null,
        maxScrollPct: n % 17 === 0 ? 60 : null,
        pageType: "Article",
        topics: title.includes("Pinecone") ? ["vector databases"] : [],
      });
      if (n % 17 === 0) {
        content.push({
          id,
          visitedAt: visitedAt + n * 60_000,
          title,
          url: `https://example.com/notes/${id}`,
          topics: title.includes("Pinecone") ? ["vector databases"] : [],
          excerpt: `${title}. Synthetic excerpt for the seed sheet.`,
        });
      }
    }
  }

  const needleAt = now - 10 * 86_400_000;
  visits.push({
    id: "needle-pinecone",
    visitedAt: needleAt,
    title: "What the Pinecone article said about metadata filters",
    url: "https://example.com/articles/pinecone-filters",
    domain: "example.com",
    dwellMinutes: 12,
    maxScrollPct: 80,
    pageType: "Article",
    topics: ["vector databases"],
  });
  content.push({
    id: "needle-pinecone",
    visitedAt: needleAt,
    title: "What the Pinecone article said about metadata filters",
    url: "https://example.com/articles/pinecone-filters",
    topics: ["vector databases"],
    excerpt: "Metadata filters run before the nearest neighbor search.",
  });
  searches.push({
    id: "needle-search",
    visitedAt: needleAt + 3_600_000,
    engine: "Google",
    query: "who from Tesla did I look at",
  });
  people.push({
    id: "needle-tesla",
    visitedAt: needleAt + 7_200_000,
    name: "Ada Marin",
    headline: "Factory software",
    company: "Tesla",
    profileUrl: "https://www.linkedin.com/in/ada-marin/",
    howFound: "search",
    dwellMinutes: 4,
    maxScrollPct: 50,
  });
  companies.push({
    id: "needle-company",
    visitedAt: needleAt + 8_000_000,
    company: "Tesla",
    sectionViewed: "People",
    linkedinUrl: "https://www.linkedin.com/company/tesla-motors/",
    dwellMinutes: 3,
  });

  const workbook = buildWorkbook(
    { visits, content, searches, people, companies },
    { title: SEED_SHEET_NAME, timeZone, syncedAt }
  );
  return { workbook, needles: ["needle-pinecone", "needle-search", "needle-tesla", "needle-company"] };
}
