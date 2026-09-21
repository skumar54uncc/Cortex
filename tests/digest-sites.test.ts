import { describe, it, expect } from "vitest";
import { groupSourcesByDomain, DIGEST_SOURCE_CAP } from "../src/lib/chat/digest-engine";
import type { DigestSource } from "../src/lib/chat/digest-types";

/**
 * The digest lists what you saw per site, so the per-site counts have to
 * cover the whole period, not only the pages the model happened to cite.
 */
function src(n: number, domain: string): DigestSource {
  return { n, url: `https://${domain}/p${n}`, title: `Page ${n}`, domain, visitedAt: 0 };
}

describe("digest per-site grouping", () => {
  it("counts every page of the period, busiest site first", () => {
    const sources = [
      ...Array.from({ length: 17 }, (_, i) => src(i + 1, "www.coach.com")),
      ...Array.from({ length: 12 }, (_, i) => src(i + 18, "www.youtube.com")),
      src(30, "gemini.google.com"),
    ];
    const groups = groupSourcesByDomain(sources);
    expect(groups.map((g) => [g.domain, g.count])).toEqual([
      ["www.coach.com", 17],
      ["www.youtube.com", 12],
      ["gemini.google.com", 1],
    ]);
    expect(groups[0]!.sourceIndexes.length).toBeGreaterThan(0);
    expect(groups[0]!.sourceIndexes.every((n) => n >= 1 && n <= 17)).toBe(true);
  });

  it("keeps enough sources for a busy day, so counts are not truncated at 24", () => {
    expect(DIGEST_SOURCE_CAP).toBeGreaterThanOrEqual(200);
  });
});
