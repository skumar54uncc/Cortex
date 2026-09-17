import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  groupConversationsByRecency,
  filterConversations,
  createPendingDelete,
  RECENCY_GROUP_ORDER,
  type ConversationSummary,
} from "../src/content/chat-history";

const DAY = 24 * 60 * 60 * 1000;
/** Wednesday 2026-09-16 15:00 local */
const NOW = new Date(2026, 8, 16, 15, 0, 0).getTime();

function conv(id: number, title: string, updatedAt: number): ConversationSummary {
  return { id, title, updatedAt };
}

describe("groupConversationsByRecency", () => {
  it("buckets by calendar day relative to now: Today, Yesterday, Last 7 days, Last 30 days, Older", () => {
    const convs = [
      conv(1, "this morning", new Date(2026, 8, 16, 8, 0).getTime()),
      conv(2, "just now", NOW - 60_000),
      conv(3, "yesterday late", new Date(2026, 8, 15, 23, 30).getTime()),
      conv(4, "yesterday early", new Date(2026, 8, 15, 0, 5).getTime()),
      conv(5, "three days ago", NOW - 3 * DAY),
      conv(6, "six days ago", NOW - 6 * DAY),
      conv(7, "twenty days ago", NOW - 20 * DAY),
      conv(8, "forty days ago", NOW - 40 * DAY),
      conv(9, "last year", NOW - 400 * DAY),
    ];
    const groups = groupConversationsByRecency(convs, NOW);
    expect(groups.map((g) => g.label)).toEqual([
      "Today",
      "Yesterday",
      "Last 7 days",
      "Last 30 days",
      "Older",
    ]);
    expect(groups[0].items.map((c) => c.id)).toEqual([2, 1]);
    expect(groups[1].items.map((c) => c.id)).toEqual([3, 4]);
    expect(groups[2].items.map((c) => c.id)).toEqual([5, 6]);
    expect(groups[3].items.map((c) => c.id)).toEqual([7]);
    expect(groups[4].items.map((c) => c.id)).toEqual([8, 9]);
  });

  it("omits empty groups and keeps the canonical order", () => {
    const groups = groupConversationsByRecency(
      [conv(1, "old", NOW - 100 * DAY), conv(2, "now", NOW)],
      NOW
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Older"]);
    expect(RECENCY_GROUP_ORDER).toEqual(["Today", "Yesterday", "Last 7 days", "Last 30 days", "Older"]);
  });

  it("boundary: 00:00 today is Today, 23:59 yesterday is Yesterday, exactly 7 calendar days ago is Last 30 days", () => {
    const startOfToday = new Date(2026, 8, 16, 0, 0, 0).getTime();
    const groups = groupConversationsByRecency(
      [
        conv(1, "midnight", startOfToday),
        conv(2, "before midnight", startOfToday - 1),
        conv(3, "seven days", new Date(2026, 8, 9, 12, 0).getTime()),
        conv(4, "six days", new Date(2026, 8, 10, 12, 0).getTime()),
      ],
      NOW
    );
    const byLabel = Object.fromEntries(groups.map((g) => [g.label, g.items.map((c) => c.id)]));
    expect(byLabel["Today"]).toEqual([1]);
    expect(byLabel["Yesterday"]).toEqual([2]);
    expect(byLabel["Last 7 days"]).toEqual([4]);
    expect(byLabel["Last 30 days"]).toEqual([3]);
  });

  it("future timestamps (clock skew) land in Today", () => {
    const groups = groupConversationsByRecency([conv(1, "future", NOW + DAY)], NOW);
    expect(groups[0].label).toBe("Today");
  });

  it("returns no groups for an empty list", () => {
    expect(groupConversationsByRecency([], NOW)).toEqual([]);
  });
});

describe("filterConversations", () => {
  const convs = [
    conv(1, "Rocket radiator notes", NOW),
    conv(2, "Kubernetes scheduling", NOW),
    conv(3, "Untitled chat", NOW),
  ];
  it("matches case-insensitively on title, trims the query, and returns all for an empty query", () => {
    expect(filterConversations(convs, "").map((c) => c.id)).toEqual([1, 2, 3]);
    expect(filterConversations(convs, "  ROCKET ").map((c) => c.id)).toEqual([1]);
    expect(filterConversations(convs, "sched").map((c) => c.id)).toEqual([2]);
    expect(filterConversations(convs, "zzz")).toEqual([]);
  });
  it("matches every word of a multi-word query in any order", () => {
    expect(filterConversations(convs, "radiator rocket").map((c) => c.id)).toEqual([1]);
    expect(filterConversations(convs, "rocket kube")).toEqual([]);
  });
});

describe("createPendingDelete (5s undo)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("commits after 5s unless undone", () => {
    const commit = vi.fn(async () => undefined);
    const pd = createPendingDelete(7, commit, { delayMs: 5000 });
    vi.advanceTimersByTime(4999);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledWith(7);
    expect(pd.isPending()).toBe(false);
  });

  it("undo cancels the commit", () => {
    const commit = vi.fn(async () => undefined);
    const pd = createPendingDelete(7, commit, { delayMs: 5000 });
    expect(pd.isPending()).toBe(true);
    pd.undo();
    vi.advanceTimersByTime(10_000);
    expect(commit).not.toHaveBeenCalled();
    expect(pd.isPending()).toBe(false);
  });

  it("flush commits immediately (used when the overlay closes)", () => {
    const commit = vi.fn(async () => undefined);
    const pd = createPendingDelete(3, commit, { delayMs: 5000 });
    pd.flush();
    expect(commit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
