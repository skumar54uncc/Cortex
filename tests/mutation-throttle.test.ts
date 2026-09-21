import { describe, it, expect } from "vitest";
import { shouldReindexAfterMutation, MUTATION_REINDEX_INTERVAL_MS } from "../src/content/mutation-throttle";

describe("shouldReindexAfterMutation", () => {
  it("allows the first mutation driven pass", () => {
    expect(shouldReindexAfterMutation(null, 1_000)).toBe(true);
  });

  it("holds off while the page keeps changing, then allows one through", () => {
    const start = 1_000_000;
    expect(shouldReindexAfterMutation(start, start + 1_000)).toBe(false);
    expect(shouldReindexAfterMutation(start, start + MUTATION_REINDEX_INTERVAL_MS - 1)).toBe(false);
    expect(shouldReindexAfterMutation(start, start + MUTATION_REINDEX_INTERVAL_MS)).toBe(true);
  });
});
