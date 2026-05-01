import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "./rate-limiter";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows under the cap", () => {
    const lim = new RateLimiter(60_000);
    expect(lim.check("a", 3)).toBe(true);
    expect(lim.check("a", 3)).toBe(true);
    expect(lim.check("a", 3)).toBe(true);
    expect(lim.check("a", 3)).toBe(false);
  });

  it("uses independent buckets per key", () => {
    const lim = new RateLimiter(60_000);
    expect(lim.check("x", 1)).toBe(true);
    expect(lim.check("x", 1)).toBe(false);
    expect(lim.check("y", 1)).toBe(true);
  });

  it("resets after the window slides", () => {
    const lim = new RateLimiter(60_000);
    expect(lim.check("k", 1)).toBe(true);
    expect(lim.check("k", 1)).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(lim.check("k", 1)).toBe(true);
  });
});
