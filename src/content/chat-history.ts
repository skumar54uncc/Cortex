/**
 * Chat history helpers for the Ask sidebar: recency grouping, title filter,
 * and the 5 second undo window for deletes. Pure functions, no DOM.
 */
export interface ConversationSummary {
  id: number;
  title: string;
  updatedAt: number;
}

export type RecencyLabel = "Today" | "Yesterday" | "Last 7 days" | "Last 30 days" | "Older";

export const RECENCY_GROUP_ORDER: RecencyLabel[] = [
  "Today",
  "Yesterday",
  "Last 7 days",
  "Last 30 days",
  "Older",
];

export interface RecencyGroup {
  label: RecencyLabel;
  items: ConversationSummary[];
}

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function daysAgo(startOfToday: number, ts: number): number {
  // Calendar-day distance in local time, robust to DST (round instead of floor).
  const startOfThat = startOfLocalDay(ts);
  return Math.round((startOfToday - startOfThat) / 86_400_000);
}

export function recencyLabelFor(updatedAt: number, now: number): RecencyLabel {
  if (updatedAt >= now) return "Today";
  const today = startOfLocalDay(now);
  const d = daysAgo(today, updatedAt);
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return "Last 7 days";
  if (d < 30) return "Last 30 days";
  return "Older";
}

/** Groups in canonical order, newest first inside each group, empty groups omitted. */
export function groupConversationsByRecency(
  convs: ConversationSummary[],
  now: number
): RecencyGroup[] {
  const buckets = new Map<RecencyLabel, ConversationSummary[]>();
  for (const label of RECENCY_GROUP_ORDER) buckets.set(label, []);
  const sorted = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const c of sorted) {
    buckets.get(recencyLabelFor(c.updatedAt, now))!.push(c);
  }
  const out: RecencyGroup[] = [];
  for (const label of RECENCY_GROUP_ORDER) {
    const items = buckets.get(label)!;
    if (items.length) out.push({ label, items });
  }
  return out;
}

/** Every whitespace-separated word must appear in the title (case-insensitive). */
export function filterConversations(
  convs: ConversationSummary[],
  query: string
): ConversationSummary[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return convs;
  return convs.filter((c) => {
    const t = (c.title || "").toLowerCase();
    return words.every((w) => t.includes(w));
  });
}

export interface PendingDelete {
  id: number;
  isPending: () => boolean;
  undo: () => void;
  flush: () => void;
}

export const UNDO_DELETE_MS = 5000;

/** Schedules `commit(id)` after `delayMs`; `undo()` cancels, `flush()` commits now. */
export function createPendingDelete(
  id: number,
  commit: (id: number) => Promise<void> | void,
  opts: { delayMs?: number } = {}
): PendingDelete {
  const delayMs = opts.delayMs ?? UNDO_DELETE_MS;
  let pending = true;
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null;
    if (!pending) return;
    pending = false;
    void commit(id);
  }, delayMs);

  return {
    id,
    isPending: () => pending,
    undo: () => {
      if (!pending) return;
      pending = false;
      if (timer != null) clearTimeout(timer);
      timer = null;
    },
    flush: () => {
      if (!pending) return;
      pending = false;
      if (timer != null) clearTimeout(timer);
      timer = null;
      void commit(id);
    },
  };
}
