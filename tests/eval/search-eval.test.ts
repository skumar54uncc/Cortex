/**
 * Search quality regression suite — synthetic corpus (`fixtures/search-eval-corpus.json`).
 * Replace or augment corpus with a real IndexedDB export over time; keep pass-rate threshold.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentRecord, ChunkRecord } from "../../src/db/schema";
import { runAdvancedSearch } from "../../src/lib/search-engine";

type CorpusFile = { documents: DocumentRecord[]; chunks: ChunkRecord[] };
type EvalQuery = {
  query: string;
  minHits?: number;
  topHitUrlIncludes?: string;
  anyHitUrlIncludes?: string;
  mustNotIncludeUrl?: string;
};

const fixtureDir = join(process.cwd(), "tests/eval/fixtures");
const corpus = JSON.parse(
  readFileSync(join(fixtureDir, "search-eval-corpus.json"), "utf8")
) as CorpusFile;
const queries = JSON.parse(
  readFileSync(join(fixtureDir, "search-eval-queries.json"), "utf8")
) as EvalQuery[];

const allUrls = new Set(corpus.documents.map((d) => d.url));

const mocks = vi.hoisted(() => ({
  docs: [] as DocumentRecord[],
  chunks: [] as ChunkRecord[],
}));

vi.mock("../../src/db/schema", () => ({
  db: {
    documents: {
      toArray: vi.fn(async () => mocks.docs),
    },
    chunks: {
      toArray: vi.fn(async () => mocks.chunks),
    },
  },
  getUrlsVisitedBetween: vi.fn(async () => allUrls),
}));

function evalPasses(
  res: Awaited<ReturnType<typeof runAdvancedSearch>>,
  q: EvalQuery
): boolean {
  const hits = res.hits ?? [];
  if (q.minHits != null && hits.length < q.minHits) return false;
  if (q.topHitUrlIncludes !== undefined) {
    const top = hits[0]?.url ?? "";
    if (!top.includes(q.topHitUrlIncludes)) return false;
  }
  if (q.anyHitUrlIncludes !== undefined) {
    const sub = q.anyHitUrlIncludes;
    if (!hits.some((h) => h.url.includes(sub))) return false;
  }
  if (q.mustNotIncludeUrl !== undefined) {
    const banned = q.mustNotIncludeUrl;
    if (hits.some((h) => h.url.includes(banned))) return false;
  }
  return true;
}

describe("eval: search quality (synthetic corpus)", () => {
  beforeEach(() => {
    mocks.docs = corpus.documents;
    mocks.chunks = corpus.chunks;
  });

  it(`meets minimum pass rate across ${queries.length} fixture queries`, async () => {
    const MIN_RATE = 0.85;
    let passed = 0;
    const failures: string[] = [];

    for (const q of queries) {
      const res = await runAdvancedSearch(q.query, async () => null);
      if (evalPasses(res, q)) {
        passed++;
      } else {
        failures.push(
          `"${q.query}" → hits=${res.hits?.length ?? 0} top=${res.hits?.[0]?.url ?? "—"}`
        );
      }
    }

    const rate = passed / queries.length;
    if (rate < MIN_RATE) {
      // eslint-disable-next-line no-console
      console.error(
        `Eval failures (showing up to 12):\n${failures.slice(0, 12).join("\n")}`
      );
    }
    expect(rate).toBeGreaterThanOrEqual(MIN_RATE);
  });
});
