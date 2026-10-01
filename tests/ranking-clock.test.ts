import { describe, expect, it } from "vitest";
import { recencyBoost } from "../src/lib/ranking";
import { parseAskQuery } from "../src/lib/query-parse";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-03T16:00:00.000Z");

describe("recencyBoost clock", () => {
  it("is 1 at the pinned instant and halves after one half-life", () => {
    expect(recencyBoost(NOW, 18, NOW)).toBe(1);
    expect(recencyBoost(NOW - 18 * DAY, 18, NOW)).toBeCloseTo(0.5, 5);
  });

  it("does not depend on the wall clock when now is passed", () => {
    const age = recencyBoost(NOW - 18 * DAY, 18, NOW);
    expect(age).toBeCloseTo(0.5, 5);
    expect(age).not.toBeCloseTo(recencyBoost(NOW - 18 * DAY, 18, NOW + 400 * DAY), 2);
  });
});

describe("parseAskQuery clock", () => {
  it("resolves yesterday against the injected now", () => {
    const parsed = parseAskQuery("notes from yesterday", NOW);
    expect(parsed.timeRange).toBeDefined();
    const start = new Date(parsed.timeRange!.start);
    const end = new Date(parsed.timeRange!.end);
    expect(end.getTime() - start.getTime()).toBeLessThan(DAY);
    expect(start.getDate()).toBe(new Date(NOW - DAY).getDate());
  });
});
