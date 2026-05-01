/** Sliding-window rate limiter (per-process; resets if SW restarts). */

export class RateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(private readonly windowMs: number = 60_000) {}

  /**
   * @returns true if the action is allowed (and recorded).
   */
  check(key: string, maxPerWindow: number): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? [];
    const recent = bucket.filter((t) => now - t < this.windowMs);
    if (recent.length >= maxPerWindow) {
      this.buckets.set(key, recent);
      return false;
    }
    recent.push(now);
    this.buckets.set(key, recent);
    return true;
  }
}
