/**
 * Pages whose DOM never settles (YouTube, feeds, chat apps) fire the content
 * script's MutationObserver forever, and each one asked the service worker to
 * index again. That burned the per tab extraction budget and starved other
 * tabs. A URL change still re-indexes immediately; this only throttles the
 * "same page changed again" case.
 */
export const MUTATION_REINDEX_INTERVAL_MS = 60_000;

export function shouldReindexAfterMutation(
  lastRequestAt: number | null,
  now: number,
  intervalMs: number = MUTATION_REINDEX_INTERVAL_MS
): boolean {
  if (lastRequestAt == null) return true;
  return now - lastRequestAt >= intervalMs;
}
