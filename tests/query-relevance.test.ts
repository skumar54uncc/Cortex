import { describe, it, expect } from "vitest";
import {
  computeQueryGrounding,
  distinctiveQueryTerms,
  groundingForConfidence,
  relevanceMultiplier,
} from "../src/lib/query-relevance";
import { parseAskQuery } from "../src/lib/query-parse";
import { confidenceTier } from "../src/content/confidence";

describe("query-relevance", () => {
  it("treats career/health as generic, atrium as distinctive", () => {
    const terms = ["atrium", "health", "career", "portal", "exploration"];
    expect(distinctiveQueryTerms(terms)).toEqual(["atrium"]);
  });

  it("penalizes pages that only match generic words", () => {
    const q = "Atrium Health Career Portal Exploration";
    const parsed = parseAskQuery(q);
    const terms = q.toLowerCase().split(/\s+/);

    const passes = computeQueryGrounding(
      "From day one in my social media career I felt supported as a creator.",
      "https://www.passes.com/",
      "Passes - scale your content",
      terms,
      parsed.entityTerms
    );
    const atrium = computeQueryGrounding(
      "Job search results for Atrium Health careers portal.",
      "https://careers.atriumhealth.org/search?q=admin",
      "Job Search Results",
      terms,
      parsed.entityTerms
    );

    expect(atrium.distinctive).toBeGreaterThan(passes.distinctive);
    expect(relevanceMultiplier(atrium)).toBeGreaterThan(relevanceMultiplier(passes));
    expect(groundingForConfidence(atrium)).toBeGreaterThan(
      groundingForConfidence(passes)
    );
  });

  it("extracts Title Case entity phrases", () => {
    const parsed = parseAskQuery("Atrium Health Career Portal Exploration");
    expect(parsed.entityTerms.some((e) => /atrium health/i.test(e))).toBe(true);
  });
});

describe("confidenceTier with grounding", () => {
  it("downgrades strong batch rank when distinctive terms are missing", () => {
    const top = confidenceTier(0.95, 1, 0.9);
    const weak = confidenceTier(0.95, 1, 0.15);
    expect(top.label).toBe("Strong match");
    expect(weak.label).not.toBe("Strong match");
  });
});
