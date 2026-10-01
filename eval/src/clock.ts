/**
 * Frozen "now" for retrieval eval.
 * Equals the latest captured_at in the 160-page corpus (gen pages end
 * 2026-10-03T16:00:00.000Z). Recency and "yesterday" / "today" / "last week"
 * are scored against this instant, not the wall clock, so two runs on
 * different days are comparable.
 */
export const EVAL_PINNED_NOW_ISO = "2026-10-03T16:00:00.000Z";
export const EVAL_PINNED_NOW_MS = Date.parse(EVAL_PINNED_NOW_ISO);
